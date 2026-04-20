import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getStartDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':  return new Date(now.getTime() - 7  * 86_400_000);
    case '30d': return new Date(now.getTime() - 30 * 86_400_000);
    case '90d': return new Date(now.getTime() - 90 * 86_400_000);
    default:    return null;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function weekStart(d: Date): string {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  return isoDate(copy);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') ?? '30d';
    const startDate = getStartDate(period);

    const tradeWhere = {
      status: 'closed',
      ...(startDate ? { closedAt: { gte: startDate } } : {}),
    };

    const [closedTrades, latestSnapshot, openCount] = await Promise.all([
      prisma.trade.findMany({
        where: tradeWhere,
        orderBy: { closedAt: 'asc' },
        select: {
          id: true, pair: true, type: true,
          pnl: true, pnlPercent: true,
          entryPrice: true, exitPrice: true, volume: true,
          createdAt: true, closedAt: true, closeReason: true,
        },
      }),
      prisma.portfolioSnapshot.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { unrealizedPnl: true, totalValue: true },
      }),
      prisma.trade.count({ where: { status: 'open' } }),
    ]);

    // --- Summary ---
    const totalRealized = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const wins   = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl ?? 0) <= 0);
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
    const avgWin  = wins.length   > 0 ? wins.reduce((s, t)   => s + (t.pnl ?? 0), 0) / wins.length   : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;

    const tradesWithDuration = closedTrades.filter(t => t.closedAt);
    const avgHoldMinutes = tradesWithDuration.length > 0
      ? tradesWithDuration.reduce((s, t) => {
          return s + (new Date(t.closedAt!).getTime() - new Date(t.createdAt).getTime()) / 60_000;
        }, 0) / tradesWithDuration.length
      : 0;

    // --- Cumulative P&L series ---
    let cumPnl = 0;
    const cumulativeSeries = closedTrades.map(t => {
      cumPnl += t.pnl ?? 0;
      return {
        date: t.closedAt ? isoDate(new Date(t.closedAt)) : null,
        cumulativePnl: +cumPnl.toFixed(2),
        tradePnl: +(t.pnl ?? 0).toFixed(2),
        pair: t.pair,
      };
    });

    // --- Max drawdown ---
    let peak = 0;
    let maxDrawdown = 0;
    for (const p of cumulativeSeries) {
      if (p.cumulativePnl > peak) peak = p.cumulativePnl;
      const dd = peak - p.cumulativePnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // --- Best / worst ---
    const sorted = [...closedTrades].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
    const best  = sorted[0] ?? null;
    const worst = sorted[sorted.length - 1] ?? null;

    // --- Period breakdowns ---
    type Bucket = { pnl: number; trades: number; wins: number };
    const roll = (map: Record<string, Bucket>, key: string, pnl: number) => {
      if (!map[key]) map[key] = { pnl: 0, trades: 0, wins: 0 };
      map[key].pnl    += pnl;
      map[key].trades += 1;
      if (pnl > 0) map[key].wins += 1;
    };

    const dayMap: Record<string, Bucket>   = {};
    const weekMap: Record<string, Bucket>  = {};
    const monthMap: Record<string, Bucket> = {};

    for (const t of closedTrades) {
      const pnl = t.pnl ?? 0;
      if (!t.closedAt) continue;
      const d = new Date(t.closedAt);
      roll(dayMap,   isoDate(d),  pnl);
      roll(weekMap,  weekStart(d), pnl);
      roll(monthMap, monthKey(d),  pnl);
    }

    const toBucketArray = (map: Record<string, Bucket>, labelKey: string) =>
      Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ [labelKey]: k, ...v, pnl: +v.pnl.toFixed(2) }));

    // --- Per-pair ---
    const pairMap: Record<string, Bucket> = {};
    for (const t of closedTrades) roll(pairMap, t.pair, t.pnl ?? 0);
    const pairBreakdown = Object.entries(pairMap)
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .map(([pair, v]) => ({
        pair, ...v,
        pnl: +v.pnl.toFixed(2),
        winRate: v.trades > 0 ? +(v.wins / v.trades).toFixed(3) : 0,
      }));

    // --- Close reasons ---
    const reasonMap: Record<string, number> = {};
    for (const t of closedTrades) {
      const r = t.closeReason ?? 'unknown';
      reasonMap[r] = (reasonMap[r] ?? 0) + 1;
    }

    // --- Recent trades (last 20) ---
    const recentTrades = [...closedTrades]
      .sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime())
      .slice(0, 20)
      .map(t => ({
        id: t.id,
        pair: t.pair,
        type: t.type,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl != null ? +t.pnl.toFixed(2) : null,
        pnlPercent: t.pnlPercent != null ? +t.pnlPercent.toFixed(2) : null,
        closeReason: t.closeReason,
        closedAt: t.closedAt,
      }));

    return NextResponse.json({
      success: true,
      summary: {
        totalRealized:  +totalRealized.toFixed(2),
        unrealizedPnl:  +(latestSnapshot?.unrealizedPnl ?? 0).toFixed(2),
        portfolioValue: +(latestSnapshot?.totalValue ?? 0).toFixed(2),
        totalTrades:    closedTrades.length,
        openTrades:     openCount,
        winRate:        +winRate.toFixed(4),
        winCount:       wins.length,
        lossCount:      losses.length,
        avgWin:         +avgWin.toFixed(2),
        avgLoss:        +avgLoss.toFixed(2),
        avgHoldMinutes: +avgHoldMinutes.toFixed(1),
        maxDrawdown:    +maxDrawdown.toFixed(2),
        bestTrade:  best  ? { pair: best.pair,  pnl: best.pnl,  pnlPercent: best.pnlPercent  } : null,
        worstTrade: worst ? { pair: worst.pair, pnl: worst.pnl, pnlPercent: worst.pnlPercent } : null,
        closeReasons: reasonMap,
      },
      cumulativeSeries,
      dailyBreakdown:   toBucketArray(dayMap,   'date'),
      weeklyBreakdown:  toBucketArray(weekMap,  'weekStart'),
      monthlyBreakdown: toBucketArray(monthMap, 'month'),
      pairBreakdown,
      recentTrades,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(msg, 'DB_ERROR');
  }
}
