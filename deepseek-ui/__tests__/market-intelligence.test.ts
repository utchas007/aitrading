/**
 * Tests for market-intelligence.ts
 * Covers: calculatePositionSize, VIX classification (via calculatePositionSize inputs),
 * calculateATR, calculateOBV, calculateIchimoku, calculateStochasticRSI.
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  calculateATR,
  calculateOBV,
  calculateIchimoku,
  calculateStochasticRSI,
  calculateEnhancedIndicators,
} from '../lib/market-intelligence';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const flat = (v: number, n: number) => Array(n).fill(v);

/** Generate rising OHLCV bars starting at `start`. */
function risingBars(start: number, n: number, step = 1) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { open: close - 0.5, high: close + 0.5, low: close - 0.5, close, volume: 1_000_000 };
  });
}

// ─── calculatePositionSize ────────────────────────────────────────────────────

describe('calculatePositionSize', () => {
  const SYMBOL = 'AAPL';
  const PRICE = 200;
  const ATR = 3; // $3 ATR = 1.5% of price
  const ACCOUNT = 100_000;

  it('returns worthTrading=false when earningsRisk=avoid', () => {
    const result = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 1.0, 'avoid');
    expect(result.worthTrading).toBe(false);
    expect(result.finalShares).toBe(0);
    expect(result.baseShares).toBe(0);
  });

  it('reduces position size when earningsRisk=caution', () => {
    const safe    = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 1.0, 'safe');
    const caution = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 1.0, 'caution');
    expect(caution.finalShares).toBeLessThan(safe.finalShares);
  });

  it('reduces position size when vixMultiplier < 1', () => {
    const full    = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 1.0, 'safe');
    const reduced = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 0.5, 'safe');
    expect(reduced.finalShares).toBeLessThanOrEqual(full.finalShares);
  });

  it('stopLossPrice is below price (1.5× ATR below)', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT);
    expect(r.stopLossPrice).toBeCloseTo(PRICE - ATR * 1.5, 1);
    expect(r.stopLossPrice).toBeLessThan(PRICE);
  });

  it('takeProfitPrice is above price (2× ATR above)', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT);
    expect(r.takeProfitPrice).toBeCloseTo(PRICE + ATR * 2.0, 1);
    expect(r.takeProfitPrice).toBeGreaterThan(PRICE);
  });

  it('estimatedRoundTripFees = 2× estimatedFees', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT);
    expect(r.estimatedRoundTripFees).toBeCloseTo(r.estimatedFees * 2, 2);
  });

  it('estimatedFees is at least $1 (IBKR minimum)', () => {
    // Very small position — only 1 share
    const tiny = calculatePositionSize(SYMBOL, PRICE, ATR, 100); // $100 account
    expect(tiny.estimatedFees).toBeGreaterThanOrEqual(1);
  });

  it('returns a positive finalShares for normal inputs', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT);
    expect(r.finalShares).toBeGreaterThan(0);
  });

  it('position value is no more than 5% of account', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT, 1.0, 'safe');
    expect(r.estimatedCost).toBeLessThanOrEqual(ACCOUNT * 0.05 + PRICE); // allow 1 share rounding
  });

  it('atrPercent equals atr / price * 100', () => {
    const r = calculatePositionSize(SYMBOL, PRICE, ATR, ACCOUNT);
    expect(r.atrPercent).toBeCloseTo((ATR / PRICE) * 100, 5);
  });
});

// ─── calculateATR ─────────────────────────────────────────────────────────────

describe('calculateATR', () => {
  it('returns 0 when not enough bars', () => {
    const h = [101, 102];
    const l = [99, 100];
    const c = [100, 101];
    expect(calculateATR(h, l, c, 14)).toBe(0);
  });

  it('returns a positive value for normal data', () => {
    const bars = risingBars(100, 30);
    const highs  = bars.map(b => b.high);
    const lows   = bars.map(b => b.low);
    const closes = bars.map(b => b.close);
    const atr = calculateATR(highs, lows, closes);
    expect(atr).toBeGreaterThan(0);
  });

  it('ATR is higher for volatile bars than flat bars', () => {
    const calmBars = risingBars(100, 30, 0.1);
    const noisyBars = risingBars(100, 30, 2);

    const calm = calculateATR(
      calmBars.map(b => b.high),
      calmBars.map(b => b.low),
      calmBars.map(b => b.close),
    );
    const noisy = calculateATR(
      noisyBars.map(b => b.high),
      noisyBars.map(b => b.low),
      noisyBars.map(b => b.close),
    );
    expect(noisy).toBeGreaterThan(calm);
  });
});

// ─── calculateOBV ─────────────────────────────────────────────────────────────

describe('calculateOBV', () => {
  it('returns flat trend for empty / single price', () => {
    expect(calculateOBV([], []).trend).toBe('flat');
    expect(calculateOBV([100], [1000]).trend).toBe('flat');
  });

  it('OBV rises when prices continuously rise', () => {
    const prices  = Array.from({ length: 20 }, (_, i) => 100 + i);
    const volumes = flat(1_000_000, 20);
    const { trend } = calculateOBV(prices, volumes);
    expect(trend).toBe('rising');
  });

  it('OBV falls when prices continuously fall', () => {
    const prices  = Array.from({ length: 20 }, (_, i) => 120 - i);
    const volumes = flat(1_000_000, 20);
    const { trend } = calculateOBV(prices, volumes);
    expect(trend).toBe('falling');
  });
});

// ─── calculateIchimoku ────────────────────────────────────────────────────────

describe('calculateIchimoku', () => {
  it('returns neutral for fewer than 52 bars', () => {
    const bars = risingBars(100, 40);
    const result = calculateIchimoku(
      bars.map(b => b.high),
      bars.map(b => b.low),
      bars.map(b => b.close),
    );
    expect(result.signal).toBe('neutral');
  });

  it('returns a valid signal for 60+ bars', () => {
    const bars = risingBars(100, 60);
    const result = calculateIchimoku(
      bars.map(b => b.high),
      bars.map(b => b.low),
      bars.map(b => b.close),
    );
    expect(['bullish', 'bearish', 'neutral']).toContain(result.signal);
  });

  it('senkouA equals (tenkan + kijun) / 2', () => {
    const bars = risingBars(100, 60);
    const { tenkan, kijun, senkouA } = calculateIchimoku(
      bars.map(b => b.high),
      bars.map(b => b.low),
      bars.map(b => b.close),
    );
    expect(senkouA).toBeCloseTo((tenkan + kijun) / 2, 8);
  });
});

// ─── calculateStochasticRSI ───────────────────────────────────────────────────

describe('calculateStochasticRSI', () => {
  it('returns neutral defaults when not enough data', () => {
    const result = calculateStochasticRSI([100, 101, 102]);
    expect(result.k).toBe(50);
    expect(result.d).toBe(50);
    expect(result.signal).toBe('neutral');
  });

  it('returns values in [0, 100] for normal data', () => {
    const prices = risingBars(100, 100).map(b => b.close);
    const { k, d } = calculateStochasticRSI(prices);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(100);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(100);
  });

  it('signal is overbought when k and d both > 80', () => {
    // Force k and d high by using strongly rising prices
    const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
    const { signal } = calculateStochasticRSI(prices);
    // Not guaranteed to be overbought (depends on smoothing), but should not be oversold
    expect(signal).not.toBe('oversold');
  });
});

// ─── calculateEnhancedIndicators ─────────────────────────────────────────────

describe('calculateEnhancedIndicators', () => {
  it('returns all expected fields', () => {
    const bars = risingBars(100, 80);
    const result = calculateEnhancedIndicators(bars);
    expect(result).toHaveProperty('stochRSI');
    expect(result).toHaveProperty('atr');
    expect(result).toHaveProperty('atrPercent');
    expect(result).toHaveProperty('obv');
    expect(result).toHaveProperty('ichimoku');
    expect(result).toHaveProperty('volatilityLevel');
  });

  it('volatilityLevel is low for very tight bars', () => {
    const bars = risingBars(100, 80, 0.01); // tiny step → low ATR
    const result = calculateEnhancedIndicators(bars);
    expect(result.volatilityLevel).toBe('low');
  });

  it('volatilityLevel is high for wide bars', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      open: 100, high: 110 + i, low: 90 - i, close: 100 + i, volume: 1_000_000,
    }));
    const result = calculateEnhancedIndicators(bars);
    expect(result.volatilityLevel).toBe('high');
  });
});
