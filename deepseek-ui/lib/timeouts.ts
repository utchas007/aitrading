/**
 * Centralised timeout constants for all fetch/abort operations.
 *
 * Using named constants instead of inline magic numbers makes it obvious
 * WHY a particular timeout was chosen and lets us tune them in one place.
 */
export const TIMEOUTS = {
  /**
   * Quick health/status probes, portfolio snapshots, and internal
   * service-to-service checks.  If a local service doesn't respond in 5s
   * it is effectively down.
   */
  HEALTH_MS: 5_000,

  /**
   * Live ticker/price lookups.  These should return fast — if they don't,
   * the data is stale anyway.
   */
  TICKER_MS: 5_000,

  /**
   * External third-party APIs: Yahoo Finance (tickers, SPY, VIX),
   * CNN Fear & Greed, EarningsWhispers, Reddit, Reuters/Yahoo RSS feeds.
   * Allow slightly more time than a local service call.
   */
  EXTERNAL_API_MS: 10_000,

  /**
   * Historical OHLCV bar requests.  IB and Yahoo both need more time when
   * returning many bars (e.g. 1-year daily, 5-min intraday).
   */
  HISTORICAL_MS: 20_000,

  /**
   * Very short probe used only to check whether the standalone trading-bot
   * process is alive on port 3002.  If it doesn't respond in 300 ms it is
   * not ready and we fall back to the in-process engine.
   */
  BOT_PROBE_MS: 300,
} as const;
