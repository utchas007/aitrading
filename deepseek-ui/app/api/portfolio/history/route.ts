import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/portfolio/history?days=7&limit=100
 * Returns portfolio history from PostgreSQL
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get('days') || '7');
    const limit = parseInt(searchParams.get('limit') || '200');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: {
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        totalValue: true,
        cadBalance: true,
        btcBalance: true,
        ethBalance: true,
        solBalance: true,
        btcPrice: true,
        ethPrice: true,
        solPrice: true,
      },
    });

    // Calculate P&L from first snapshot
    let pnl = 0;
    let pnlPercent = 0;
    if (snapshots.length >= 2) {
      const first = snapshots[0].totalValue;
      const last = snapshots[snapshots.length - 1].totalValue;
      pnl = last - first;
      pnlPercent = first > 0 ? ((last - first) / first) * 100 : 0;
    }

    // Format for chart
    const history = snapshots.map((s: typeof snapshots[0]) => ({
      timestamp: s.createdAt.getTime(),
      totalValue: s.totalValue,
      cadBalance: s.cadBalance,
      btcBalance: s.btcBalance,
      ethBalance: s.ethBalance,
      solBalance: s.solBalance,
    }));

    return NextResponse.json({
      success: true,
      history,
      summary: {
        count: snapshots.length,
        firstValue: snapshots[0]?.totalValue || 0,
        lastValue: snapshots[snapshots.length - 1]?.totalValue || 0,
        pnl,
        pnlPercent,
        days,
      },
    });
  } catch (error: any) {
    console.error('Portfolio history error:', error);
    return NextResponse.json(
      { success: false, error: error.message, history: [] },
      { status: 500 }
    );
  }
}
