import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/portfolio/history');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/portfolio/history?days=7&limit=100
 * Returns IB portfolio history from PostgreSQL
 */
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const { searchParams } = new URL(req.url);
    const days  = parseInt(searchParams.get('days')  || '7');
    const limit = parseInt(searchParams.get('limit') || '200');

    const since = new Date();
    since.setDate(since.getDate() - days);

    let snapshots = await prisma.portfolioSnapshot.findMany({
      where:   { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take:    limit,
      select: {
        id:            true,
        createdAt:     true,
        totalValue:    true,
        cadCash:       true,
        unrealizedPnl: true,
        realizedPnl:   true,
        buyingPower:   true,
      },
    });

    // If the requested window has no rows (e.g. no snapshots in last 7d),
    // fall back to the latest available history so the UI is not empty.
    let fallbackUsed = false;
    if (snapshots.length === 0) {
      const latest = await prisma.portfolioSnapshot.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id:            true,
          createdAt:     true,
          totalValue:    true,
          cadCash:       true,
          unrealizedPnl: true,
          realizedPnl:   true,
          buyingPower:   true,
        },
      });
      snapshots = latest.reverse();
      fallbackUsed = snapshots.length > 0;
    }

    // Calculate P&L from first snapshot in the window
    let pnl = 0;
    let pnlPercent = 0;
    if (snapshots.length >= 2) {
      const first = snapshots[0].totalValue;
      const last  = snapshots[snapshots.length - 1].totalValue;
      pnl        = last - first;
      pnlPercent = first > 0 ? ((last - first) / first) * 100 : 0;
    }

    const history = snapshots.map(s => ({
      timestamp:     s.createdAt.getTime(),
      totalValue:    s.totalValue,
      cadCash:       s.cadCash,
      unrealizedPnl: s.unrealizedPnl,
      realizedPnl:   s.realizedPnl,
      buyingPower:   s.buyingPower,
    }));

    const values = snapshots.map(s => s.totalValue);
    const currentValue  = values[values.length - 1] ?? 0;
    const highestValue  = values.length > 0 ? Math.max(...values) : 0;
    const lowestValue   = values.length > 0 ? Math.min(...values) : 0;

    return NextResponse.json({
      success: true,
      history,
      stats: {
        currentValue,
        highestValue,
        lowestValue,
        pnl,
        pnlPercent,
        count: snapshots.length,
      },
      summary: {
        count:      snapshots.length,
        firstValue: snapshots[0]?.totalValue || 0,
        lastValue:  currentValue,
        pnl,
        pnlPercent,
        days,
        fallbackUsed,
      },
    });
  } catch (error: any) {
    log.error('Portfolio history error', { error: error.message });
    return apiError(error.message, 'DB_ERROR', { extra: { history: [] } });
  }
  });
}
