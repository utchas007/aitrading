/**
 * Activity Logger
 * Tracks and broadcasts bot activities in real-time
 * Also persists to PostgreSQL database
 */

import { createLogger } from './logger';

const log = createLogger('activity');

/** Retention period for ActivityLog rows (default: 90 days). */
const ACTIVITY_RETENTION_DAYS = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS ?? '90', 10);

/** Retention period for Notification rows (default: 90 days). */
const NOTIFICATION_RETENTION_DAYS = parseInt(process.env.NOTIFICATION_RETENTION_DAYS ?? '90', 10);
const RETENTION_CLEANUP_ENABLED = process.env.NODE_ENV !== 'test'
  && process.env.DISABLE_ACTIVITY_RETENTION_CLEANUP !== '1';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ActivityLogRow {
  id: string | number;
  createdAt: Date;
  type: string;
  message: string;
  pair: string | null;
}

/**
 * Run cleanup once at startup and then every 24 hours.
 * Deletes rows older than the configured retention period from:
 *   - ActivityLog  (default 90 days)
 *   - Notification (default 90 days)
 */
async function startRetentionCleanup(): Promise<void> {
  const runCleanup = async () => {
    try {
      const { prisma } = await import('./db');

      // ActivityLog cleanup
      const activityCutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const activityResult = await prisma.activityLog.deleteMany({
        where: { createdAt: { lt: activityCutoff } },
      });
      if (activityResult.count > 0) {
        log.info(`ActivityLog retention: deleted ${activityResult.count} rows older than ${ACTIVITY_RETENTION_DAYS} days`);
      }

      // Notification cleanup
      const notificationCutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const notificationResult = await prisma.notification.deleteMany({
        where: { createdAt: { lt: notificationCutoff } },
      });
      if (notificationResult.count > 0) {
        log.info(`Notification retention: deleted ${notificationResult.count} rows older than ${NOTIFICATION_RETENTION_DAYS} days`);
      }
    } catch (error: unknown) {
      log.warn('Retention cleanup failed', { error: getErrorMessage(error) });
    }
  };

  // Run immediately on startup, then every 24 hours
  await runCleanup();
  setInterval(runCleanup, 24 * 60 * 60 * 1000);
}

// Kick off cleanup in background — never blocks the logger init
if (RETENTION_CLEANUP_ENABLED) {
  void startRetentionCleanup();
}

// Async DB write — fire and forget, never blocks the bot
async function persistToDb(type: string, message: string, pair?: string): Promise<void> {
  try {
    // Dynamic import to avoid issues if DB is not available
    const { prisma } = await import('./db');
    await prisma.activityLog.create({
      data: { type, message, pair: pair || null },
    });
  } catch {
    // Silently fail — DB persistence is non-critical
  }
}

// Load recent activities from database
async function loadFromDb(limit: number = 50): Promise<Activity[]> {
  try {
    const { prisma } = await import('./db');
    const dbActivities = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, createdAt: true, type: true, message: true, pair: true },
    });
    return dbActivities.map((a: ActivityLogRow) => ({
      id: String(a.id),
      timestamp: new Date(a.createdAt).getTime(),
      type: a.type as ActivityType,
      message: a.message,
      icon: getIconForType(a.type as ActivityType),
      color: getColorForType(a.type as ActivityType),
    }));
  } catch {
    return [];
  }
}

// Helper functions for icon/color (used by both class and loadFromDb)
function getIconForType(type: ActivityType): string {
  const icons: Record<ActivityType, string> = {
    searching: '🔍',
    analyzing: '📊',
    calculating: '🧮',
    executing: '⚡',
    completed: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  };
  return icons[type] || 'ℹ️';
}

function getColorForType(type: ActivityType): string {
  const colors: Record<ActivityType, string> = {
    searching: '#00ff9f',
    analyzing: '#0066ff',
    calculating: '#ffd60a',
    executing: '#ff4d6d',
    completed: '#00ff9f',
    error: '#ff4d6d',
    info: '#888',
    warning: '#ffd60a',
  };
  return colors[type] || '#888';
}

export type ActivityType = 
  | 'searching'
  | 'analyzing'
  | 'calculating'
  | 'executing'
  | 'completed'
  | 'error'
  | 'info'
  | 'warning';

export interface Activity {
  id: string;
  timestamp: number;
  type: ActivityType;
  message: string;
  icon: string;
  color: string;
}

export class ActivityLogger {
  private activities: Activity[] = [];
  private maxActivities: number = 100;
  private listeners: Set<(activity: Activity) => void> = new Set();
  private dbLoaded: boolean = false;

  /**
   * Load activities from database (call once on init)
   */
  async loadFromDatabase(): Promise<void> {
    if (this.dbLoaded) return;
    const dbActivities = await loadFromDb(this.maxActivities);
    // Merge with in-memory (in-memory takes priority for recent)
    const existingIds = new Set(this.activities.map(a => a.id));
    for (const act of dbActivities) {
      if (!existingIds.has(act.id)) {
        this.activities.push(act);
      }
    }
    // Sort by timestamp descending
    this.activities.sort((a, b) => b.timestamp - a.timestamp);
    // Trim to max
    this.activities = this.activities.slice(0, this.maxActivities);
    this.dbLoaded = true;
  }

  /**
   * Log an activity
   */
  log(type: ActivityType, message: string): void {
    const activity: Activity = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type,
      message,
      icon: this.getIcon(type),
      color: this.getColor(type),
    };

    this.activities.unshift(activity);
    
    // Keep only last N activities
    if (this.activities.length > this.maxActivities) {
      this.activities = this.activities.slice(0, this.maxActivities);
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(activity));

    // Log to structured logger
    log.info(`${activity.icon} ${message}`, { type });

    // Persist to database (fire and forget)
    persistToDb(type, message);
  }

  /**
   * Subscribe to activity updates
   */
  subscribe(callback: (activity: Activity) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get all activities
   */
  getActivities(): Activity[] {
    return [...this.activities];
  }

  /**
   * Clear all activities
   */
  clear(): void {
    this.activities = [];
  }

  /**
   * Get icon for activity type
   */
  private getIcon(type: ActivityType): string {
    return getIconForType(type);
  }

  /**
   * Get color for activity type
   */
  private getColor(type: ActivityType): string {
    return getColorForType(type);
  }
}

// Global singleton instance
let globalLogger: ActivityLogger | null = null;

/**
 * Get global activity logger instance
 */
export function getActivityLogger(): ActivityLogger {
  if (!globalLogger) {
    globalLogger = new ActivityLogger();
  }
  return globalLogger;
}

/**
 * Helper functions for common activities
 */
export const logActivity = {
  searching: (message: string) => getActivityLogger().log('searching', message),
  analyzing: (message: string) => getActivityLogger().log('analyzing', message),
  calculating: (message: string) => getActivityLogger().log('calculating', message),
  executing: (message: string) => getActivityLogger().log('executing', message),
  completed: (message: string) => getActivityLogger().log('completed', message),
  error: (message: string) => getActivityLogger().log('error', message),
  info: (message: string) => getActivityLogger().log('info', message),
  warning: (message: string) => getActivityLogger().log('warning', message),
};
