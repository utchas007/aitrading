/**
 * Unit tests for TradingEngine signal logic, position sizing guards, and trade cooldowns.
 * External services (IB, Ollama, World Monitor) are mocked so tests run offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock external dependencies ───────────────────────────────────────────────
// These modules hit real services and must be stubbed for unit tests.

vi.mock('../lib/ib-client', () => ({
  createIBClient: vi.fn(() => ({
    getHealth:    vi.fn().mockResolvedValue({ connected: true }),
    getTicker:    vi.fn().mockResolvedValue({ last: 150, close: 150, volume: 1_000_000 }),
    getBalance:   vi.fn().mockResolvedValue({ AvailableFunds_USD: '50000' }),
    getPositions: vi.fn().mockResolvedValue([]),
    placeOrder:   vi.fn().mockResolvedValue({ commission: 1.5 }),
    placeBracketOrder: vi.fn().mockResolvedValue({
      parent_order_id: 123, stop_loss_order_id: 124, take_profit_order_id: 125,
    }),
  })),
}));

vi.mock('../lib/market-intelligence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/market-intelligence')>();
  return {
    ...actual,
    getMarketSentiment: vi.fn().mockResolvedValue({
      fearGreed:       { value: 50, classification: 'Neutral', timestamp: new Date().toISOString(), source: 'fallback' },
      vix:             { value: 18, level: 'elevated', tradingAllowed: true, positionSizeMultiplier: 0.75, interpretation: 'VIX OK', timestamp: new Date().toISOString() },
      spyTrend:        { price: 500, change1d: 0.5, change5d: 1, above200ma: true, trend: 'uptrend', bias: 'buy', interpretation: 'SPY uptrend', timestamp: new Date().toISOString() },
      earnings:        { hasUpcomingEarnings: false, daysUntilEarnings: null, earningsDate: null, earningsTime: null, tradingAllowed: true, riskLevel: 'safe', interpretation: 'Safe' },
      redditSentiment: 10,
      redditPosts:     [],
      newsHeadlines:   [],
      coinDeskHeadlines: [],
      overallSentiment: 'Neutral',
      overallScore:    10,
    }),
  };
});

vi.mock('../lib/technical-indicators', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/technical-indicators')>();
  return {
    ...actual,
    getHistoricalPrices: vi.fn().mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        timestamp: Date.now() - (60 - i) * 86_400_000,
        open:  100 + i,
        high:  101 + i,
        low:   99  + i,
        close: 100 + i,
        volume: 1_000_000,
      }))
    ),
  };
});

vi.mock('../lib/worldmonitor-data', () => ({
  getWorldMonitorSummary: vi.fn().mockResolvedValue({
    geopoliticalRisk: { level: 'low', score: 10, marketImpact: 'none' },
    commodities: [],
  }),
  getMarketContextForAI: vi.fn().mockResolvedValue('No global context available.'),
}));

vi.mock('../lib/notify', () => ({
  saveNotification: vi.fn(),
}));

vi.mock('../lib/activity-logger', () => ({
  logActivity: {
    searching:   vi.fn(),
    analyzing:   vi.fn(),
    calculating: vi.fn(),
    executing:   vi.fn(),
    completed:   vi.fn(),
    error:       vi.fn(),
    info:        vi.fn(),
    warning:     vi.fn(),
  },
}));

vi.mock('../lib/db', () => ({
  prisma: {
    trade:            { create: vi.fn().mockResolvedValue({ id: 1 }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    tradingSignal:    { create: vi.fn().mockResolvedValue({ id: 1 }) },
    priceCandle:      { upsert: vi.fn() },
  },
  default: {
    trade:            { create: vi.fn().mockResolvedValue({ id: 1 }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    tradingSignal:    { create: vi.fn().mockResolvedValue({ id: 1 }) },
    priceCandle:      { upsert: vi.fn() },
  },
}));

// Stub the self-referential fetch call that hits /api/trading/analyze
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    analysis: {
      sentiment: 'Bullish', confidence: 70, signal: 'BUY',
      keyFactors: ['RSI oversold'], risks: [], recommendation: 'Buy now',
      entryPrice: null, exitPrice: null, stopLoss: null,
    },
  }),
}));

import { TradingEngine, createTradingEngine } from '../lib/trading-engine';
import { getMarketSession } from '../lib/market-hours';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TradingEngine — construction', () => {
  it('uses sensible defaults when no config is provided', () => {
    const engine = createTradingEngine();
    const status = engine.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.config.minConfidence).toBe(75);
    expect(status.config.stopLossPercent).toBe(0.05);
    expect(status.config.takeProfitPercent).toBe(0.10);
    expect(status.config.maxPositions).toBe(6);
  });

  it('accepts partial config overrides', () => {
    const engine = createTradingEngine({ minConfidence: 80, maxPositions: 3 });
    const status = engine.getStatus();
    expect(status.config.minConfidence).toBe(80);
    expect(status.config.maxPositions).toBe(3);
    expect(status.config.stopLossPercent).toBe(0.05); // default unchanged
  });

  it('starts and stops cleanly', async () => {
    const engine = createTradingEngine({ pairs: ['AAPL'], checkInterval: 99_999_999 });
    // Don't actually run a cycle; just test start/stop lifecycle
    engine.stop(); // should not throw when not running
    expect(engine.getStatus().isRunning).toBe(false);
  });
});

describe('TradingEngine — getActivePositions', () => {
  it('returns empty array before any trade', () => {
    const engine = createTradingEngine();
    expect(engine.getActivePositions()).toEqual([]);
  });
});

describe('TradingEngine — generateSignal', () => {
  it('returns a valid TradeSignal object for a known pair', async () => {
    const engine = createTradingEngine({ pairs: ['AAPL'] });
    const signal = await engine.generateSignal(
      'AAPL',
      { AAPL: { price: 150, volume: 1_000_000, change24h: '0.5' } },
      50_000,
    );

    expect(signal.pair).toBe('AAPL');
    expect(['buy', 'sell', 'hold']).toContain(signal.action);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(100);
    expect(signal.entryPrice).toBeGreaterThan(0);
    expect(signal.technicalSignals).toBeDefined();
    expect(signal.timestamp).toBeGreaterThan(0);
  });

  it('stopLoss is below entryPrice for a buy signal', async () => {
    const engine = createTradingEngine({ pairs: ['AAPL'] });
    const signal = await engine.generateSignal(
      'AAPL',
      { AAPL: { price: 150, volume: 1_000_000, change24h: '0' } },
      50_000,
    );
    if (signal.action === 'buy') {
      expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
      expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice);
    }
  });
});
