/**
 * OHLC Data Quality Validation
 *
 * Detects common data issues before they corrupt technical indicators:
 *   - Gaps: missing bars (e.g. > 3 trading days apart)
 *   - Bad bars: OHLCV where high < low, open/close outside high/low, zero prices
 *   - Outliers: price moves > 50% in a single bar (likely data error)
 *   - Flatlines: many consecutive identical closes (stale data)
 *
 * Usage:
 *   const { ok, warnings, filteredBars } = validateOHLCData(bars);
 *   if (!ok) logActivity.warning(warnings.join('; '));
 */

import type { PriceData } from './technical-indicators';
import { createLogger } from './logger';

const log = createLogger('data-quality');

export interface DataQualityResult {
  /** True if data is usable (warnings may exist but nothing critical) */
  ok: boolean;
  /** Human-readable warning messages */
  warnings: string[];
  /** Filtered bars with bad rows removed */
  filteredBars: PriceData[];
  /** Metrics about the validation */
  metrics: {
    totalBars:       number;
    badBarsRemoved:  number;
    outliersFound:   number;
    gapsFound:       number;
    flatlineCount:   number;
  };
}

const MAX_GAP_DAYS     = 3;     // Maximum acceptable gap between daily bars (trading days)
const OUTLIER_THRESHOLD = 0.50; // 50% price move in a single bar = likely bad data
const FLATLINE_MIN_BARS = 10;   // Warn if 10+ consecutive identical closes

/**
 * Validate and clean a set of OHLCV bars.
 * Always returns a usable (possibly smaller) dataset.
 */
export function validateOHLCData(
  bars: PriceData[],
  symbol: string = 'unknown',
): DataQualityResult {
  const warnings: string[] = [];
  let badBarsRemoved = 0;
  let outliersFound  = 0;
  let gapsFound      = 0;
  let flatlineCount  = 0;

  // ── Filter individual bad bars ────────────────────────────────────────────
  const filtered: PriceData[] = [];
  for (const bar of bars) {
    // Zero or negative prices
    if (bar.close <= 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0) {
      log.debug('Removed zero-price bar', { symbol, ts: bar.timestamp, close: bar.close });
      badBarsRemoved++;
      continue;
    }

    // OHLC relationship violation
    if (bar.high < bar.low) {
      log.debug('Removed bad OHLC bar (high < low)', { symbol, ts: bar.timestamp });
      badBarsRemoved++;
      continue;
    }
    if (bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high) {
      log.debug('Removed bad OHLC bar (open/close outside high-low range)', { symbol, ts: bar.timestamp });
      badBarsRemoved++;
      continue;
    }

    filtered.push(bar);
  }

  if (filtered.length < 2) {
    return {
      ok: false,
      warnings: [`${symbol}: Insufficient data after filtering (${filtered.length} bars remaining)`],
      filteredBars: filtered,
      metrics: { totalBars: bars.length, badBarsRemoved, outliersFound, gapsFound, flatlineCount },
    };
  }

  // ── Detect outlier price moves ────────────────────────────────────────────
  for (let i = 1; i < filtered.length; i++) {
    const prev  = filtered[i - 1].close;
    const curr  = filtered[i].close;
    const change = Math.abs((curr - prev) / prev);
    if (change > OUTLIER_THRESHOLD) {
      outliersFound++;
      log.debug('Outlier price move detected', { symbol, ts: filtered[i].timestamp, changePct: (change * 100).toFixed(1) });
    }
  }

  if (outliersFound > 0) {
    warnings.push(`${symbol}: ${outliersFound} outlier price move(s) detected (>${OUTLIER_THRESHOLD * 100}% single-bar swing)`);
  }

  // ── Detect temporal gaps ──────────────────────────────────────────────────
  const MS_PER_DAY = 86_400_000;
  for (let i = 1; i < filtered.length; i++) {
    const gapDays = (filtered[i].timestamp - filtered[i - 1].timestamp) / MS_PER_DAY;
    if (gapDays > MAX_GAP_DAYS) {
      gapsFound++;
    }
  }
  if (gapsFound > 0) {
    warnings.push(`${symbol}: ${gapsFound} gap(s) of > ${MAX_GAP_DAYS} calendar days between bars`);
  }

  // ── Detect flatlines ──────────────────────────────────────────────────────
  let currentFlatRun = 1;
  let maxFlatRun     = 1;
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i].close === filtered[i - 1].close) {
      currentFlatRun++;
      maxFlatRun = Math.max(maxFlatRun, currentFlatRun);
    } else {
      currentFlatRun = 1;
    }
  }
  flatlineCount = maxFlatRun;
  if (maxFlatRun >= FLATLINE_MIN_BARS) {
    warnings.push(`${symbol}: ${maxFlatRun} consecutive identical close prices — possible stale data`);
  }

  const ok = warnings.length === 0;

  if (!ok) {
    log.warn(`${symbol}: Data quality issues`, {
      badBarsRemoved, outliersFound, gapsFound, flatlineCount: maxFlatRun,
    });
  }

  return {
    ok,
    warnings,
    filteredBars: filtered,
    metrics: { totalBars: bars.length, badBarsRemoved, outliersFound, gapsFound, flatlineCount },
  };
}
