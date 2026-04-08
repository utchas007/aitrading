import { describe, it, expect } from "vitest";
import {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
} from "../lib/technical-indicators";

// Helper: generate an array of n identical prices
const flat = (price: number, n: number) => Array(n).fill(price);

// Helper: generate rising prices starting at `start`, incrementing by `step`
const rising = (start: number, n: number, step = 1) =>
  Array.from({ length: n }, (_, i) => start + i * step);

// Helper: generate falling prices
const falling = (start: number, n: number, step = 1) =>
  Array.from({ length: n }, (_, i) => start - i * step);

// ─── calculateRSI ─────────────────────────────────────────────────────────────

describe("calculateRSI", () => {
  it("returns 50 when not enough data", () => {
    expect(calculateRSI([100, 101, 102], 14)).toBe(50);
  });

  it("returns 100 for flat prices (no losses)", () => {
    // avgLoss = 0 → early return 100
    expect(calculateRSI(flat(100, 20))).toBe(100);
  });

  it("returns 100 for strictly rising prices (no losses)", () => {
    expect(calculateRSI(rising(100, 30))).toBe(100);
  });

  it("returns 0 for strictly falling prices (no gains)", () => {
    // avgGain = 0, rs = 0 → 100 - 100/(1+0) = 0
    expect(calculateRSI(falling(130, 30))).toBe(0);
  });

  it("returns ~50 for alternating up/down prices", () => {
    const prices: number[] = [];
    for (let i = 0; i < 30; i++) prices.push(100 + (i % 2 === 0 ? 1 : -1));
    const rsi = calculateRSI(prices);
    expect(rsi).toBeGreaterThan(30);
    expect(rsi).toBeLessThan(70);
  });

  it("returns a value in [0, 100]", () => {
    const prices = rising(50, 30).map((p, i) => p + Math.sin(i) * 5);
    const rsi = calculateRSI(prices);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

// ─── calculateEMA ─────────────────────────────────────────────────────────────

describe("calculateEMA", () => {
  it("returns last price when not enough data", () => {
    expect(calculateEMA([100, 101], 5)).toBe(101);
  });

  it("returns the constant value for flat prices", () => {
    const ema = calculateEMA(flat(150, 20), 12);
    expect(ema).toBeCloseTo(150, 5);
  });

  it("EMA of rising prices is below the last price (lagging)", () => {
    const prices = rising(100, 30);
    const ema = calculateEMA(prices, 12);
    expect(ema).toBeLessThan(prices[prices.length - 1]);
    expect(ema).toBeGreaterThan(prices[0]);
  });

  it("shorter period EMA reacts faster than longer period", () => {
    const prices = [...flat(100, 20), ...flat(120, 10)];
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    // After a price jump, the shorter-period EMA is closer to the new price
    expect(Math.abs(ema12 - 120)).toBeLessThan(Math.abs(ema26 - 120));
  });
});

// ─── calculateMACD ────────────────────────────────────────────────────────────

describe("calculateMACD", () => {
  it("returns zeros when not enough data", () => {
    const result = calculateMACD(flat(100, 20));
    expect(result).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it("returns all zeros for flat prices", () => {
    const result = calculateMACD(flat(100, 50));
    expect(result.macd).toBeCloseTo(0, 8);
    expect(result.signal).toBeCloseTo(0, 8);
    expect(result.histogram).toBeCloseTo(0, 8);
  });

  it("histogram equals macd minus signal", () => {
    const prices = rising(100, 60);
    const { macd, signal, histogram } = calculateMACD(prices);
    expect(histogram).toBeCloseTo(macd - signal, 10);
  });

  it("positive MACD for steadily rising prices", () => {
    // For rising prices EMA12 > EMA26 → MACD > 0
    const prices = rising(100, 60);
    const { macd } = calculateMACD(prices);
    expect(macd).toBeGreaterThan(0);
  });

  it("negative MACD for steadily falling prices", () => {
    const prices = falling(160, 60);
    const { macd } = calculateMACD(prices);
    expect(macd).toBeLessThan(0);
  });
});

// ─── calculateBollingerBands ─────────────────────────────────────────────────

describe("calculateBollingerBands", () => {
  it("upper > middle > lower for varied prices", () => {
    const prices = rising(100, 30).map((p, i) => p + Math.sin(i) * 3);
    const { upper, middle, lower } = calculateBollingerBands(prices);
    expect(upper).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(lower);
  });

  it("all three are equal for flat prices (zero std-dev)", () => {
    const { upper, middle, lower } = calculateBollingerBands(flat(100, 25));
    expect(upper).toBeCloseTo(100, 8);
    expect(middle).toBeCloseTo(100, 8);
    expect(lower).toBeCloseTo(100, 8);
  });

  it("middle equals SMA of last 20 prices", () => {
    const prices = rising(100, 30);
    const last20 = prices.slice(-20);
    const sma = last20.reduce((a, b) => a + b) / 20;
    const { middle } = calculateBollingerBands(prices);
    expect(middle).toBeCloseTo(sma, 8);
  });

  it("wider bands when price is more volatile", () => {
    const calm = rising(100, 25).map((p, i) => p + Math.sin(i) * 0.5);
    const volatile = rising(100, 25).map((p, i) => p + Math.sin(i) * 10);
    const bandWidthCalm = calculateBollingerBands(calm).upper - calculateBollingerBands(calm).lower;
    const bandWidthVol  = calculateBollingerBands(volatile).upper - calculateBollingerBands(volatile).lower;
    expect(bandWidthVol).toBeGreaterThan(bandWidthCalm);
  });

  it("handles fewer prices than period by using all available", () => {
    const { upper, middle, lower } = calculateBollingerBands([100, 102, 98]);
    expect(upper).toBeGreaterThanOrEqual(middle);
    expect(lower).toBeLessThanOrEqual(middle);
  });
});
