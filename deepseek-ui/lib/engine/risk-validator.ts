/**
 * Risk Validator
 *
 * Validates whether a trade is allowed based on:
 *   - Daily trade limit
 *   - Cooldown period per pair
 *   - Expected profit margin (must exceed round-trip fees)
 *
 * Extracted from TradingEngine.isTradeAllowed() and TradingEngine.executeSignal().
 */

import type { TradeSignal } from './signal-generator';

export interface TradeGuardConfig {
  maxDailyTrades:     number;
  tradeCooldownHours: number;
  tradingFeePercent:  number;
  minProfitMargin:    number;
}

export interface TradeAllowedResult {
  allowed: boolean;
  reason?: string;
  expectedProfitPercent?: number;
}

/**
 * Check whether a trade signal passes all risk validation gates.
 *
 * @param signal            The proposed trade signal
 * @param dailyTradeCount   How many trades have been executed today
 * @param lastTradeTime     Map of pair → last trade timestamp (ms)
 * @param config            Risk guard configuration
 */
export function isTradeAllowed(
  signal: TradeSignal,
  dailyTradeCount: number,
  lastTradeTime: Map<string, number>,
  config: TradeGuardConfig,
): TradeAllowedResult {
  // ── Daily trade limit ───────────────────────────────────────────────────
  if (dailyTradeCount >= config.maxDailyTrades) {
    return {
      allowed: false,
      reason: `Daily trade limit reached (${config.maxDailyTrades} trades/day)`,
    };
  }

  // ── Cooldown per pair ───────────────────────────────────────────────────
  const lastTrade = lastTradeTime.get(signal.pair);
  if (lastTrade) {
    const hoursSince = (Date.now() - lastTrade) / (1000 * 60 * 60);
    if (hoursSince < config.tradeCooldownHours) {
      const hoursRemaining = (config.tradeCooldownHours - hoursSince).toFixed(1);
      return {
        allowed: false,
        reason: `Cooldown active. Wait ${hoursRemaining} more hours before trading ${signal.pair}`,
      };
    }
  }

  // ── Expected profit after fees ──────────────────────────────────────────
  const roundTripFee = config.tradingFeePercent * 2;
  const expectedMove =
    signal.action === 'buy'
      ? (signal.takeProfit - signal.entryPrice) / signal.entryPrice
      : (signal.entryPrice - signal.takeProfit) / signal.entryPrice;
  const expectedProfitPercent = (expectedMove - roundTripFee) * 100;

  if (expectedProfitPercent < config.minProfitMargin * 100) {
    return {
      allowed: false,
      reason:
        `Expected profit ${expectedProfitPercent.toFixed(2)}% below minimum ` +
        `${(config.minProfitMargin * 100).toFixed(2)}% (after ${(roundTripFee * 100).toFixed(2)}% fees)`,
      expectedProfitPercent,
    };
  }

  return { allowed: true, expectedProfitPercent };
}
