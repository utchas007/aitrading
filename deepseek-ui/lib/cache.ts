/**
 * Lightweight in-memory TTL cache for expensive external API calls.
 *
 * Prevents hammering rate-limited services (CNN Fear & Greed, Yahoo Finance,
 * IB balance) on every trading cycle.
 *
 * Usage:
 *   const cache = new TtlCache<FearGreedData>(60 * 60 * 1000); // 1 hour TTL
 *   const data = await cache.getOrFetch('feargreed', () => getFearGreedIndex());
 */

export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /** Get a cached value or fetch it fresh (and cache the result). */
  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
    const value = await fetcher();
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Explicitly invalidate a cached entry. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Check if a key is currently cached and not expired. */
  has(key: string): boolean {
    const cached = this.store.get(key);
    return !!cached && Date.now() < cached.expiresAt;
  }

  /** Remove all expired entries (call periodically to free memory). */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }
}

// ─── Singleton caches ─────────────────────────────────────────────────────────

/** Fear & Greed Index — CNN rate-limits aggressively; cache for 1 hour. */
export const fearGreedCache = new TtlCache<import('./market-intelligence').FearGreedData>(
  60 * 60 * 1000, // 1 hour
);

/** IB account balance — changes rarely; cache for 30 seconds within a cycle. */
export const ibBalanceCache = new TtlCache<Record<string, string>>(
  30 * 1000, // 30 seconds
);

/** OHLC bars — daily bars don't change intraday; cache for 5 minutes. */
export const ohlcCache = new TtlCache<import('./technical-indicators').PriceData[]>(
  5 * 60 * 1000, // 5 minutes
);

/** VIX data — slow-moving, cache for 15 minutes. */
export const vixCache = new TtlCache<import('./market-intelligence').VixData>(
  15 * 60 * 1000, // 15 minutes
);

/** SPY trend — cache for 5 minutes (refreshes on market open). */
export const spyTrendCache = new TtlCache<import('./market-intelligence').SpyTrend>(
  5 * 60 * 1000, // 5 minutes
);
