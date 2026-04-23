/**
 * Technical-only backtesting engine.
 *
 * Replays the bot's signal logic against stored daily OHLCV candles without
 * making any live IB or AI API calls. Useful for strategy validation before
 * going live with real money.
 */

import { analyzeTechnicalIndicators, PriceData } from './technical-indicators';
import {
  DEFAULT_MIN_CONFIDENCE, DEFAULT_STOP_LOSS_PERCENT, DEFAULT_TAKE_PROFIT_PERCENT,
  DEFAULT_PARTIAL_PROFIT_PERCENT, DEFAULT_TRAILING_ACTIVATION_PERCENT,
  DEFAULT_TRAILING_STOP_PERCENT, DEFAULT_RISK_PER_TRADE,
  VOLUME_CONFIRMATION_RATIO, BB_BELOW_RSI_MAX, BB_ABOVE_RSI_MIN,
} from './constants';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCash: number;
  minConfidence: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  partialProfitPercent: number;
  trailingActivationPercent: number;
  trailingStopPercent: number;
  riskPerTrade: number;
}

export const DEFAULT_BACKTEST_CONFIG: Omit<BacktestConfig, 'symbol' | 'startDate' | 'endDate'> = {
  initialCash:               100_000,
  minConfidence:             DEFAULT_MIN_CONFIDENCE,
  stopLossPercent:           DEFAULT_STOP_LOSS_PERCENT,
  takeProfitPercent:         DEFAULT_TAKE_PROFIT_PERCENT,
  partialProfitPercent:      DEFAULT_PARTIAL_PROFIT_PERCENT,
  trailingActivationPercent: DEFAULT_TRAILING_ACTIVATION_PERCENT,
  trailingStopPercent:       DEFAULT_TRAILING_STOP_PERCENT,
  riskPerTrade:              DEFAULT_RISK_PER_TRADE,
};

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  symbol: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPercent: number;
  closeReason: 'stop_loss' | 'take_profit' | 'end_of_range';
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  avgHoldDays: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  dataPoints: number;
}

// ─── Internal position state ──────────────────────────────────────────────────

interface SimPosition {
  entryDate: string;
  entryPrice: number;
  type: 'buy' | 'sell';
  shares: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice: number;
  lowestPrice: number;
  partialTaken: boolean;
  partialPnl: number;
  cost: number; // entryPrice × original shares (for pnlPercent)
}

// ─── Signal generation (technical only, no AI/IB calls) ──────────────────────

function computeSignal(bars: PriceData[], minConfidence: number): {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
} {
  if (bars.length < 50) return { action: 'hold', confidence: 0 };

  const s = analyzeTechnicalIndicators(bars);
  let score = 0;
  let total = 0;

  if (s.rsiSignal === 'oversold')      { score++; total++; }
  else if (s.rsiSignal === 'overbought') { score--; total++; }

  if (s.macd.trend === 'bullish')      { score++; total++; }
  else if (s.macd.trend === 'bearish') { score--; total++; }

  if (s.bollingerBands.position === 'below') { score++; total++; }
  else if (s.bollingerBands.position === 'above') { score--; total++; }

  if (s.ema.trend === 'bullish')       { score++; total++; }
  else if (s.ema.trend === 'bearish')  { score--; total++; }

  if (total === 0) return { action: 'hold', confidence: 0 };

  const norm = score / total;
  let confidence = Math.round(Math.abs(norm) * 100);

  let action: 'buy' | 'sell' | 'hold' = 'hold';
  if (norm > 0.25)       action = 'buy';
  else if (norm < -0.25) action = 'sell';

  if (action === 'hold') return { action, confidence: 0 };

  // Volume confirmation — reduce confidence if volume is weak
  if (!s.volume.spike) confidence = Math.max(0, confidence - 10);

  // BB + RSI micro-filters (same logic as live engine)
  if (action === 'buy'  && s.bollingerBands.position === 'below' && s.rsi > BB_BELOW_RSI_MAX) {
    return { action: 'hold', confidence: 0 };
  }
  if (action === 'sell' && s.bollingerBands.position === 'above' && s.rsi < BB_ABOVE_RSI_MIN) {
    return { action: 'hold', confidence: 0 };
  }

  return { action, confidence };
}

// ─── Main backtest runner ─────────────────────────────────────────────────────

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { prisma } = await import('./db');

  // Pull candles: fetch extra lookback (100 days) before startDate so indicators
  // are warm on the very first bar inside the date range.
  const lookbackSec = 100 * 86_400;
  const startSec    = Math.floor(config.startDate.getTime() / 1000);
  const endSec      = Math.floor(config.endDate.getTime()   / 1000);

  const candles = await prisma.priceCandle.findMany({
    where: {
      pair:     config.symbol,
      interval: 1440,
      time:     { gte: startSec - lookbackSec, lte: endSec },
    },
    orderBy: { time: 'asc' },
  });

  if (candles.length < 60) {
    throw new Error(
      `Not enough data for ${config.symbol}: only ${candles.length} daily bars in DB. ` +
      `Run the bot for a while first, or pick a different symbol/date range.`
    );
  }

  const allBars: PriceData[] = candles.map(c => ({
    timestamp: c.time * 1000,
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume,
  }));

  // ── Walk forward ──────────────────────────────────────────────────────────

  let equity = config.initialCash;
  let peakEquity = equity;
  let position: SimPosition | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 50; i < allBars.length; i++) {
    const bar    = allBars[i];
    const barMs  = bar.timestamp;
    if (barMs < config.startDate.getTime()) continue; // still in lookback window

    const dateStr  = new Date(barMs).toISOString().split('T')[0];
    const lookback = allBars.slice(Math.max(0, i - 100), i + 1);

    // ── Manage open position ────────────────────────────────────────────────
    if (position) {
      const current = bar.close;

      // Update water marks
      if (current > position.highestPrice) position.highestPrice = current;
      if (current < position.lowestPrice)  position.lowestPrice  = current;

      // Profit fraction on remaining shares
      const pnlFrac = position.type === 'buy'
        ? (current - position.entryPrice) / position.entryPrice
        : (position.entryPrice - current) / position.entryPrice;

      // Partial profit at partialProfitPercent
      if (!position.partialTaken && pnlFrac >= config.partialProfitPercent) {
        const half = Math.floor(position.shares / 2);
        if (half >= 1) {
          const locked = (position.type === 'buy'
            ? (current - position.entryPrice)
            : (position.entryPrice - current)) * half;
          equity             += locked;
          position.partialPnl = locked;
          position.partialTaken = true;
          position.shares      -= half;
        }
      }

      // Trailing stop ratchet
      if (pnlFrac >= config.trailingActivationPercent) {
        const newStop = position.type === 'buy'
          ? position.highestPrice * (1 - config.trailingStopPercent)
          : position.lowestPrice  * (1 + config.trailingStopPercent);
        const improved = position.type === 'buy'
          ? newStop > position.stopLoss
          : newStop < position.stopLoss;
        if (improved) position.stopLoss = newStop;
      }

      // Check SL / TP using the bar's high/low (conservative intraday touch simulation)
      const slHit = position.type === 'buy' ? bar.low  <= position.stopLoss   : bar.high >= position.stopLoss;
      const tpHit = position.type === 'buy' ? bar.high >= position.takeProfit : bar.low  <= position.takeProfit;

      if (slHit || tpHit) {
        const exitPrice    = slHit ? position.stopLoss : position.takeProfit;
        const remainingPnl = (position.type === 'buy'
          ? (exitPrice - position.entryPrice)
          : (position.entryPrice - exitPrice)) * position.shares;
        const totalPnl     = remainingPnl + position.partialPnl;
        equity += remainingPnl;

        trades.push({
          entryDate:   position.entryDate,
          exitDate:    dateStr,
          symbol:      config.symbol,
          type:        position.type,
          entryPrice:  position.entryPrice,
          exitPrice:   +exitPrice.toFixed(2),
          shares:      position.shares,
          pnl:         +totalPnl.toFixed(2),
          pnlPercent:  +(totalPnl / position.cost * 100).toFixed(2),
          closeReason: slHit ? 'stop_loss' : 'take_profit',
        });
        position = null;
      }
    }

    // ── Look for new entry (only if flat) ───────────────────────────────────
    if (!position) {
      const { action, confidence } = computeSignal(lookback, config.minConfidence);

      if (action !== 'hold' && confidence >= config.minConfidence) {
        const entryPrice = bar.close;
        const shares     = Math.floor((equity * config.riskPerTrade) / entryPrice);
        if (shares >= 1) {
          const sl = action === 'buy'
            ? entryPrice * (1 - config.stopLossPercent)
            : entryPrice * (1 + config.stopLossPercent);
          const tp = action === 'buy'
            ? entryPrice * (1 + config.takeProfitPercent)
            : entryPrice * (1 - config.takeProfitPercent);

          position = {
            entryDate:    dateStr,
            entryPrice,
            type:         action,
            shares,
            stopLoss:     +sl.toFixed(2),
            takeProfit:   +tp.toFixed(2),
            highestPrice: entryPrice,
            lowestPrice:  entryPrice,
            partialTaken: false,
            partialPnl:   0,
            cost:         entryPrice * shares,
          };
        }
      }
    }

    // ── Equity curve point (mark-to-market) ─────────────────────────────────
    let mtm = equity;
    if (position) {
      const unrealized = (position.type === 'buy'
        ? (bar.close - position.entryPrice)
        : (position.entryPrice - bar.close)) * position.shares;
      mtm = equity + unrealized + position.partialPnl;
    }
    if (mtm > peakEquity) peakEquity = mtm;
    const dd    = peakEquity - mtm;
    const ddPct = peakEquity > 0 ? (dd / peakEquity) * 100 : 0;
    equityCurve.push({ date: dateStr, equity: +mtm.toFixed(2), drawdown: +dd.toFixed(2), drawdownPercent: +ddPct.toFixed(2) });
  }

  // Force-close any position still open at end of range
  if (position) {
    const last       = allBars[allBars.length - 1];
    const exitPrice  = last.close;
    const remainPnl  = (position.type === 'buy'
      ? (exitPrice - position.entryPrice)
      : (position.entryPrice - exitPrice)) * position.shares;
    const totalPnl   = remainPnl + position.partialPnl;
    equity += remainPnl;

    trades.push({
      entryDate:   position.entryDate,
      exitDate:    new Date(last.timestamp).toISOString().split('T')[0],
      symbol:      config.symbol,
      type:        position.type,
      entryPrice:  position.entryPrice,
      exitPrice:   +exitPrice.toFixed(2),
      shares:      position.shares,
      pnl:         +totalPnl.toFixed(2),
      pnlPercent:  +(totalPnl / position.cost * 100).toFixed(2),
      closeReason: 'end_of_range',
    });
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const winRate    = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin     = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnl, 0)   / wins.length   : 0;
  const avgLoss    = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const grossWins  = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? 999 : 0;

  const maxDD    = equityCurve.reduce((m, p) => Math.max(m, p.drawdown), 0);
  const maxDDPct = equityCurve.reduce((m, p) => Math.max(m, p.drawdownPercent), 0);

  const totalReturn    = equity - config.initialCash;
  const totalReturnPct = (totalReturn / config.initialCash) * 100;

  // Sharpe: annualised (√252) mean-excess-return / σ of daily returns
  const dailyReturns = equityCurve.slice(1).map((p, i) =>
    equityCurve[i].equity > 0 ? (p.equity - equityCurve[i].equity) / equityCurve[i].equity : 0
  );
  const mean    = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1);
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length || 1);
  const sharpe  = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  const avgHoldDays = trades.length > 0
    ? trades.reduce((s, t) =>
        s + (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86_400_000, 0
      ) / trades.length
    : 0;

  return {
    config,
    trades,
    equityCurve,
    dataPoints: equityCurve.length,
    metrics: {
      totalReturn:        +totalReturn.toFixed(2),
      totalReturnPercent: +totalReturnPct.toFixed(2),
      winRate:            +winRate.toFixed(4),
      winCount:           wins.length,
      lossCount:          losses.length,
      totalTrades:        trades.length,
      avgWin:             +avgWin.toFixed(2),
      avgLoss:            +avgLoss.toFixed(2),
      profitFactor:       +profitFactor.toFixed(2),
      maxDrawdown:        +maxDD.toFixed(2),
      maxDrawdownPercent: +maxDDPct.toFixed(2),
      sharpeRatio:        +sharpe.toFixed(3),
      avgHoldDays:        +avgHoldDays.toFixed(1),
    },
  };
}
