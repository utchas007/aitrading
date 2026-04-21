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

function round2(n: number): number {
  return +n.toFixed(2);
}

type ClosedTrade = {
  id: number;
  pair: string;
  type: string;
  pnl: number | null;
  pnlPercent: number | null;
  entryPrice: number;
  exitPrice: number | null;
  volume: number;
  stopLoss: number;
  takeProfit: number;
  expectedProfitUSD: number | null;
  expectedLossUSD: number | null;
  createdAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
};

function derivePnlFromPrices(t: ClosedTrade): number | null {
  if (t.exitPrice == null || !Number.isFinite(t.entryPrice) || !Number.isFinite(t.volume) || t.volume <= 0) {
    return null;
  }
  if (t.type === 'buy')  return (t.exitPrice - t.entryPrice) * t.volume;
  if (t.type === 'sell') return (t.entryPrice - t.exitPrice) * t.volume;
  return null;
}

function deriveFallbackPnl(t: ClosedTrade): number | null {
  // If explicit pnl is present and non-zero, trust DB value.
  if (t.pnl != null && Math.abs(t.pnl) > 1e-9) return t.pnl;

  // If we have meaningful fill prices, compute realized pnl directly.
  const fromPrices = derivePnlFromPrices(t);
  if (fromPrices != null && Math.abs(fromPrices) > 1e-9) return fromPrices;

  // Last resort: infer from close reason + expected TP/SL outcome.
  if (t.closeReason === 'take_profit' && t.expectedProfitUSD != null) return Math.abs(t.expectedProfitUSD);
  if (t.closeReason === 'stop_loss'   && t.expectedLossUSD   != null) return -Math.abs(t.expectedLossUSD);

  // Preserve true break-even scenarios.
  return t.pnl ?? 0;
}

function deriveFallbackPnlPercent(t: ClosedTrade, pnl: number): number {
  if (t.pnlPercent != null && Math.abs(t.pnlPercent) > 1e-9) return t.pnlPercent;
  const costBasis = t.entryPrice * t.volume;
  if (!Number.isFinite(costBasis) || costBasis <= 0) return 0;
  return (pnl / costBasis) * 100;
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
          stopLoss: true, takeProfit: true,
          expectedProfitUSD: true, expectedLossUSD: true,
          createdAt: true, closedAt: true, closeReason: true,
        },
      }),
      prisma.portfolioSnapshot.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { unrealizedPnl: true, totalValue: true },
      }),
      prisma.trade.count({ where: { status: 'open' } }),
    ]);

    const trades = closedTrades.map((t) => {
      const pnl = deriveFallbackPnl(t as ClosedTrade);
      const pnlPercent = deriveFallbackPnlPercent(t as ClosedTrade, pnl);
      return { ...t, _pnl: pnl, _pnlPercent: pnlPercent };
    });

    // --- Summary ---
    const totalRealized = trades.reduce((s, t) => s + t._pnl, 0);
    const wins   = trades.filter(t => t._pnl > 0);
    const losses = trades.filter(t => t._pnl <= 0);
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
    const avgWin  = wins.length   > 0 ? wins.reduce((s, t)   => s + t._pnl, 0) / wins.length   : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t._pnl, 0) / losses.length : 0;

    const tradesWithDuration = trades.filter(t => t.closedAt);
    const avgHoldMinutes = tradesWithDuration.length > 0
      ? tradesWithDuration.reduce((s, t) => {
          return s + (new Date(t.closedAt!).getTime() - new Date(t.createdAt).getTime()) / 60_000;
        }, 0) / tradesWithDuration.length
      : 0;

    // --- Cumulative P&L series ---
    let cumPnl = 0;
    const cumulativeSeries = trades.map(t => {
      cumPnl += t._pnl;
      return {
        date: t.closedAt ? isoDate(new Date(t.closedAt)) : null,
        cumulativePnl: round2(cumPnl),
        tradePnl: round2(t._pnl),
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
    const sorted = [...trades].sort((a, b) => b._pnl - a._pnl);
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

    for (const t of trades) {
      const pnl = t._pnl;
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
    for (const t of trades) roll(pairMap, t.pair, t._pnl);
    const pairBreakdown = Object.entries(pairMap)
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .map(([pair, v]) => ({
        pair, ...v,
        pnl: +v.pnl.toFixed(2),
        winRate: v.trades > 0 ? +(v.wins / v.trades).toFixed(3) : 0,
      }));

    // --- Close reasons ---
    const reasonMap: Record<string, number> = {};
    for (const t of trades) {
      const r = t.closeReason ?? 'unknown';
      reasonMap[r] = (reasonMap[r] ?? 0) + 1;
    }

    // --- Recent trades (last 20) ---
    const recentTrades = [...trades]
      .sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime())
      .slice(0, 20)
      .map(t => ({
        id: t.id,
        pair: t.pair,
        type: t.type,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: round2(t._pnl),
        pnlPercent: round2(t._pnlPercent),
        closeReason: t.closeReason,
        closedAt: t.closedAt,
      }));

    return NextResponse.json({
      success: true,
      summary: {
        totalRealized:  +totalRealized.toFixed(2),
        unrealizedPnl:  +(latestSnapshot?.unrealizedPnl ?? 0).toFixed(2),
        portfolioValue: +(latestSnapshot?.totalValue ?? 0).toFixed(2),
        totalTrades:    trades.length,
        openTrades:     openCount,
        winRate:        +winRate.toFixed(4),
        winCount:       wins.length,
        lossCount:      losses.length,
        avgWin:         +avgWin.toFixed(2),
        avgLoss:        +avgLoss.toFixed(2),
        avgHoldMinutes: +avgHoldMinutes.toFixed(1),
        maxDrawdown:    +maxDrawdown.toFixed(2),
        bestTrade:  best  ? { pair: best.pair,  pnl: round2(best._pnl),  pnlPercent: round2(best._pnlPercent)  } : null,
        worstTrade: worst ? { pair: worst.pair, pnl: round2(worst._pnl), pnlPercent: round2(worst._pnlPercent) } : null,
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
