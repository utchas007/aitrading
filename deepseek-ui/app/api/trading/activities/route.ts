/**
 * GET /api/trading/activities?page=1&limit=50&type=error&pair=AAPL&since=2026-04-15
 *
 * Paginated ActivityLog endpoint.
 * Replaces the previous approach of embedding all activities in /api/trading/engine GET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/trading/activities');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const { searchParams } = new URL(req.url);

      // Pagination
      const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10));
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)));
      const skip  = (page - 1) * limit;

      // Filters
      const type  = searchParams.get('type')  ?? undefined;
      const pair  = searchParams.get('pair')  ?? undefined;
      const since = searchParams.get('since') ?? undefined;

      const where: Record<string, unknown> = {};
      if (type)  where.type     = type;
      if (pair)  where.pair     = pair;
      if (since) where.createdAt = { gte: new Date(since) };

      const [activities, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: { id: true, createdAt: true, type: true, message: true, pair: true },
        }),
        prisma.activityLog.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        success:    true,
        activities,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error: any) {
      log.error('Activities query failed', { error: error.message });
      return apiError(error.message, 'DB_ERROR');
    }
  });
}
