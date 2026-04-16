/**
 * GET /api/cron/cleanup
 *
 * Retention cleanup for ActivityLog and Notification tables.
 * Deletes rows older than the configured retention period.
 *
 * This is the RELIABLE cleanup path — call it from an external cron job
 * so cleanup runs even when the standalone bot is not running.
 *
 * CRON SETUP (daily at 3 AM):
 *   0 3 * * * curl -s -H "X-Cron-Secret: <your-secret>" \
 *     http://localhost:3001/api/cron/cleanup >> /var/log/trading-cleanup.log 2>&1
 *
 * Security: requires X-Cron-Secret header matching CRON_SECRET env var.
 * If CRON_SECRET is not set, the endpoint is blocked in production.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('cron/cleanup');

const ACTIVITY_RETENTION_DAYS    = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS   ?? '90', 10);
const NOTIFICATION_RETENTION_DAYS = parseInt(process.env.NOTIFICATION_RETENTION_DAYS  ?? '90', 10);
const CRON_SECRET                 = process.env.CRON_SECRET ?? '';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    // ── Auth ──────────────────────────────────────────────────────────────
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd && !CRON_SECRET) {
      return apiError(
        'CRON_SECRET env var is not set. Set it to a random secret and pass it in the X-Cron-Secret header.',
        'SERVICE_UNAVAILABLE',
        { status: 403 },
      );
    }

    if (CRON_SECRET) {
      const provided = req.headers.get('x-cron-secret') ?? '';
      if (provided !== CRON_SECRET) {
        log.warn('Cron cleanup: invalid secret');
        return apiError('Unauthorized', 'UNAUTHORIZED', { status: 401 });
      }
    }

    // ── Run cleanup ───────────────────────────────────────────────────────
    try {
      const now = Date.now();

      const activityCutoff     = new Date(now - ACTIVITY_RETENTION_DAYS     * 24 * 60 * 60 * 1000);
      const notificationCutoff = new Date(now - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      const [activityResult, notificationResult] = await Promise.all([
        prisma.activityLog.deleteMany({
          where: { createdAt: { lt: activityCutoff } },
        }),
        prisma.notification.deleteMany({
          where: { createdAt: { lt: notificationCutoff } },
        }),
      ]);

      log.info('Retention cleanup complete', {
        activityDeleted:     activityResult.count,
        notificationDeleted: notificationResult.count,
        activityRetainDays:  ACTIVITY_RETENTION_DAYS,
        notificationRetainDays: NOTIFICATION_RETENTION_DAYS,
      });

      return NextResponse.json({
        success: true,
        deleted: {
          activityLog:   activityResult.count,
          notifications: notificationResult.count,
        },
        retentionDays: {
          activityLog:   ACTIVITY_RETENTION_DAYS,
          notifications: NOTIFICATION_RETENTION_DAYS,
        },
        ranAt: new Date().toISOString(),
      });
    } catch (error: any) {
      log.error('Retention cleanup failed', { error: error.message });
      return apiError(error.message, 'DB_ERROR');
    }
  });
}
