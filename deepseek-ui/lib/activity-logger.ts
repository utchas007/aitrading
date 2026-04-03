/**
 * Activity Logger
 * Tracks and broadcasts bot activities in real-time
 * Also persists to PostgreSQL database
 */

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
    });
    return dbActivities.map((a: any) => ({
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

    // Console log with color
    const timeStr = new Date(activity.timestamp).toLocaleTimeString();
    console.log(`[${timeStr}] ${activity.icon} ${message}`);

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
