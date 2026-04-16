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

    const snapshots = await prisma.portfolioSnapshot.findMany({
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

    return NextResponse.json({
      success: true,
      history,
      summary: {
        count:      snapshots.length,
        firstValue: snapshots[0]?.totalValue || 0,
        lastValue:  snapshots[snapshots.length - 1]?.totalValue || 0,
        pnl,
        pnlPercent,
        days,
      },
    });
  } catch (error: any) {
    log.error('Portfolio history error', { error: error.message });
    return apiError(error.message, 'DB_ERROR', { extra: { history: [] } });
  }
  });
}
