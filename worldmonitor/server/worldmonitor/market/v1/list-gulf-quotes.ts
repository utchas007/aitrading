/**
 * RPC: ListGulfQuotes
 * Fetches GCC stock indices, Gulf currencies, and oil benchmarks.
 *
 * Fallback chain per data type:
 *   Indices   → Yahoo Finance → Stooq (free, no key)
 *   Currencies → Yahoo Finance → ExchangeRate-API (free, no key)
 *   Oil        → Yahoo Finance → FRED → EIA (reused from commodity quotes)
 *
 * Inspired by https://github.com/koala73/worldmonitor/pull/641 (@aa5064).
 */

import type {
  ServerContext,
  ListGulfQuotesRequest,
  ListGulfQuotesResponse,
  GulfQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { fetchYahooQuotesBatch, UPSTREAM_TIMEOUT_MS } from './_shared';
import { cachedFetchJson, getCachedJson } from '../../../_shared/redis';
import { CHROME_UA } from '../../../_shared/constants';

const REDIS_KEY = 'market:gulf-quotes:v1';
const REDIS_TTL = 480; // 8 min

const SEED_FRESHNESS_MS = 90 * 60_000; // 90 min — Railway seeds every hour

let memCache: { data: ListGulfQuotesResponse; ts: number } | null = null;
const MEM_TTL = 480_000;

interface GulfSymbolMeta {
  symbol: string;
  name: string;
  country: string;
  flag: string;
  type: 'index' | 'currency' | 'oil';
}

const GULF_SYMBOLS: GulfSymbolMeta[] = [
  // Indices — real Yahoo indices where available, iShares ETF proxies otherwise
  { symbol: '^TASI.SR', name: 'Tadawul All Share', country: 'Saudi Arabia', flag: '🇸🇦', type: 'index' },
  { symbol: 'DFMGI.AE', name: 'Dubai Financial Market', country: 'UAE', flag: '🇦🇪', type: 'index' },
  { symbol: 'UAE', name: 'Abu Dhabi (iShares)', country: 'UAE', flag: '🇦🇪', type: 'index' },
  { symbol: 'QAT', name: 'Qatar (iShares)', country: 'Qatar', flag: '🇶🇦', type: 'index' },
  { symbol: 'GULF', name: 'Gulf Dividend (WisdomTree)', country: 'Kuwait', flag: '🇰🇼', type: 'index' },
  { symbol: '^MSM', name: 'Muscat MSM 30', country: 'Oman', flag: '🇴🇲', type: 'index' },
  // Currencies (6)
  { symbol: 'SARUSD=X', name: 'Saudi Riyal', country: 'Saudi Arabia', flag: '🇸🇦', type: 'currency' },
  { symbol: 'AEDUSD=X', name: 'UAE Dirham', country: 'UAE', flag: '🇦🇪', type: 'currency' },
  { symbol: 'QARUSD=X', name: 'Qatari Riyal', country: 'Qatar', flag: '🇶🇦', type: 'currency' },
  { symbol: 'KWDUSD=X', name: 'Kuwaiti Dinar', country: 'Kuwait', flag: '🇰🇼', type: 'currency' },
  { symbol: 'BHDUSD=X', name: 'Bahraini Dinar', country: 'Bahrain', flag: '🇧🇭', type: 'currency' },
  { symbol: 'OMRUSD=X', name: 'Omani Rial', country: 'Oman', flag: '🇴🇲', type: 'currency' },
  // Oil benchmarks (2)
  { symbol: 'CL=F', name: 'WTI Crude', country: '', flag: '🛢️', type: 'oil' },
  { symbol: 'BZ=F', name: 'Brent Crude', country: '', flag: '🛢️', type: 'oil' },
];

const ALL_SYMBOLS = GULF_SYMBOLS.map(s => s.symbol);
const META_MAP = new Map(GULF_SYMBOLS.map(s => [s.symbol, s]));

// ── Stooq symbol map for GCC indices (Yahoo → Stooq) ─────────────────────────
// Stooq provides free end-of-day data for GCC indices, no API key required.
const STOOQ_INDEX_MAP: Record<string, { stooqSymbol: string; name: string; country: string; flag: string }> = {
  '^TASI.SR': { stooqSymbol: 'tasi.sr',  name: 'Tadawul All Share',        country: 'Saudi Arabia', flag: '🇸🇦' },
  'DFMGI.AE': { stooqSymbol: 'dfmgi.ae', name: 'Dubai Financial Market',   country: 'UAE',          flag: '🇦🇪' },
  '^MSM':     { stooqSymbol: 'msm30.om', name: 'Muscat MSM 30',            country: 'Oman',         flag: '🇴🇲' },
};

// ── ExchangeRate-API currency map (Yahoo symbol → currency code) ──────────────
// open.er-api.com is completely free with no API key. Updates every 24h.
// Gulf currencies are all pegged/semi-pegged to USD so daily updates are fine.
const CURRENCY_MAP: Record<string, { code: string; name: string; country: string; flag: string }> = {
  'SARUSD=X': { code: 'SAR', name: 'Saudi Riyal',    country: 'Saudi Arabia', flag: '🇸🇦' },
  'AEDUSD=X': { code: 'AED', name: 'UAE Dirham',     country: 'UAE',          flag: '🇦🇪' },
  'QARUSD=X': { code: 'QAR', name: 'Qatari Riyal',   country: 'Qatar',        flag: '🇶🇦' },
  'KWDUSD=X': { code: 'KWD', name: 'Kuwaiti Dinar',  country: 'Kuwait',       flag: '🇰🇼' },
  'BHDUSD=X': { code: 'BHD', name: 'Bahraini Dinar', country: 'Bahrain',      flag: '🇧🇭' },
  'OMRUSD=X': { code: 'OMR', name: 'Omani Rial',     country: 'Oman',         flag: '🇴🇲' },
};

// ── FRED/EIA oil series (reused from list-commodity-quotes pattern) ───────────
const OIL_FRED: Record<string, { seriesId: string; name: string; flag: string }> = {
  'CL=F': { seriesId: 'DCOILWTICO',   name: 'WTI Crude',   flag: '🛢️' },
  'BZ=F': { seriesId: 'DCOILBRENTEU', name: 'Brent Crude', flag: '🛢️' },
};

const OIL_EIA: Record<string, { path: string; facet: string; name: string; flag: string }> = {
  'CL=F': { path: '/v2/petroleum/pri/spt/data/', facet: 'RWTC',  name: 'WTI Crude',   flag: '🛢️' },
  'BZ=F': { path: '/v2/petroleum/pri/spt/data/', facet: 'RBRTE', name: 'Brent Crude', flag: '🛢️' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Fallback fetchers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stooq fallback for GCC indices.
 * Returns CSV: Date,Open,High,Low,Close,Volume — we use the latest Close row.
 */
async function fetchStooqIndex(
  yahooSymbol: string,
): Promise<{ price: number; change: number } | null> {
  const meta = STOOQ_INDEX_MAP[yahooSymbol];
  if (!meta) return null;
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(meta.stooqSymbol)}&i=d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const csv = await resp.text();
    // CSV format: Date,Open,High,Low,Close,Volume
    const lines = csv.trim().split('\n').filter(l => !l.startsWith('Date'));
    if (lines.length < 1) return null;
    // Latest row first (Stooq returns descending)
    const latest = lines[0]!.split(',');
    const prev   = lines[1]?.split(',');
    const price  = parseFloat(latest[4] ?? '');
    const prevClose = prev ? parseFloat(prev[4] ?? '') : price;
    if (!isFinite(price) || price <= 0) return null;
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return { price, change };
  } catch {
    return null;
  }
}

/**
 * ExchangeRate-API fallback for Gulf currencies.
 * Fetches all rates in one request — free, no key, updates daily.
 */
async function fetchGulfCurrencies(
  missingSymbols: string[],
): Promise<Map<string, { price: number; change: number }>> {
  const results = new Map<string, { price: number; change: number }>();
  const relevant = missingSymbols.filter(s => s in CURRENCY_MAP);
  if (!relevant.length) return results;

  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!resp.ok) return results;
    const data = await resp.json() as { rates?: Record<string, number> };
    const rates = data.rates;
    if (!rates) return results;

    for (const sym of relevant) {
      const meta = CURRENCY_MAP[sym]!;
      const rate = rates[meta.code];
      if (!rate || !isFinite(rate) || rate <= 0) continue;
      // ExchangeRate-API gives units per 1 USD → invert to get USD per 1 unit
      const price = 1 / rate;
      // No prev close available from this endpoint — show 0% change
      results.set(sym, { price, change: 0 });
    }
  } catch {
    // fall through — results stays empty
  }
  return results;
}

/**
 * FRED fallback for WTI / Brent oil prices.
 */
async function fetchOilFromFred(
  symbol: string,
): Promise<{ price: number; change: number } | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  const meta = OIL_FRED[symbol];
  if (!meta) return null;
  try {
    const params = new URLSearchParams({
      series_id:         meta.seriesId,
      api_key:           apiKey,
      file_type:         'json',
      sort_order:        'desc',
      observation_start: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
      limit:             '5',
    });
    const resp = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { observations: Array<{ value: string }> };
    const obs = json.observations?.filter(o => o.value !== '.') ?? [];
    if (!obs.length) return null;
    const price = parseFloat(obs[0]!.value);
    const prev  = obs.length > 1 ? parseFloat(obs[1]!.value) : price;
    const change = price && prev ? ((price - prev) / prev) * 100 : 0;
    return { price, change };
  } catch {
    return null;
  }
}

/**
 * EIA fallback for WTI / Brent when FRED also misses.
 */
async function fetchOilFromEia(
  symbol: string,
): Promise<{ price: number; change: number } | null> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) return null;
  const meta = OIL_EIA[symbol];
  if (!meta) return null;
  try {
    const params = new URLSearchParams({
      api_key:              apiKey,
      'data[]':             'value',
      frequency:            'weekly',
      'facets[series][]':   meta.facet,
      'sort[0][column]':    'period',
      'sort[0][direction]': 'desc',
      length:               '2',
    });
    const resp = await fetch(`https://api.eia.gov${meta.path}?${params}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { response: { data: Array<{ value: number }> } };
    const rows = json?.response?.data ?? [];
    if (!rows.length) return null;
    const price = rows[0]!.value;
    const prev  = rows.length > 1 ? rows[1]!.value : price;
    const change = price && prev ? ((price - prev) / prev) * 100 : 0;
    return { price, change };
  } catch {
    return null;
  }
}

export async function listGulfQuotes(
  _ctx: ServerContext,
  _req: ListGulfQuotesRequest,
): Promise<ListGulfQuotesResponse> {
  const now = Date.now();

  if (memCache && now - memCache.ts < MEM_TTL) {
    return memCache.data;
  }

  try {
    const [seedData, seedMeta] = await Promise.all([
      getCachedJson(REDIS_KEY, true) as Promise<ListGulfQuotesResponse | null>,
      getCachedJson('seed-meta:market:gulf-quotes', true) as Promise<{ fetchedAt?: number } | null>,
    ]);
    if (seedData?.quotes?.length) {
      const fetchedAt = seedMeta?.fetchedAt ?? 0;
      const isFresh = now - fetchedAt < SEED_FRESHNESS_MS;
      if (isFresh || !process.env.SEED_FALLBACK_GULF) {
        memCache = { data: seedData, ts: now };
        return seedData;
      }
    }
  } catch { /* fall through to live fetch */ }

  try {
    const result = await cachedFetchJson<ListGulfQuotesResponse>(REDIS_KEY, REDIS_TTL, async () => {
      const batch = await fetchYahooQuotesBatch(ALL_SYMBOLS);

      const quotes: GulfQuote[] = [];
      const missingSymbols: string[] = [];

      // ── Layer 1: Yahoo Finance ────────────────────────────────────────────
      for (const sym of ALL_SYMBOLS) {
        const yahoo = batch.results.get(sym);
        const meta = META_MAP.get(sym)!;
        if (yahoo) {
          quotes.push({
            symbol: sym,
            name: meta.name,
            country: meta.country,
            flag: meta.flag,
            type: meta.type,
            price: yahoo.price,
            change: yahoo.change,
            sparkline: yahoo.sparkline,
          });
        } else {
          missingSymbols.push(sym);
        }
      }

      // ── Layer 2: Per-type fallbacks for anything Yahoo missed ─────────────
      if (missingSymbols.length > 0) {
        const missingIndices   = missingSymbols.filter(s => META_MAP.get(s)?.type === 'index');
        const missingCurrencies = missingSymbols.filter(s => META_MAP.get(s)?.type === 'currency');
        const missingOil       = missingSymbols.filter(s => META_MAP.get(s)?.type === 'oil');

        // Indices → Stooq
        for (const sym of missingIndices) {
          const stooq = await fetchStooqIndex(sym);
          if (stooq) {
            const meta = META_MAP.get(sym)!;
            console.info(`[Gulf] ${sym} filled from Stooq`);
            quotes.push({ symbol: sym, name: meta.name, country: meta.country, flag: meta.flag, type: meta.type, price: stooq.price, change: stooq.change, sparkline: [] });
          }
        }

        // Currencies → ExchangeRate-API (one request for all)
        if (missingCurrencies.length > 0) {
          const erRates = await fetchGulfCurrencies(missingCurrencies);
          for (const sym of missingCurrencies) {
            const rate = erRates.get(sym);
            if (rate) {
              const meta = META_MAP.get(sym)!;
              console.info(`[Gulf] ${sym} filled from ExchangeRate-API`);
              quotes.push({ symbol: sym, name: meta.name, country: meta.country, flag: meta.flag, type: meta.type, price: rate.price, change: rate.change, sparkline: [] });
            }
          }
        }

        // Oil → FRED → EIA
        for (const sym of missingOil) {
          const fred = await fetchOilFromFred(sym);
          if (fred) {
            const meta = META_MAP.get(sym)!;
            console.info(`[Gulf] ${sym} filled from FRED`);
            quotes.push({ symbol: sym, name: meta.name, country: meta.country, flag: meta.flag, type: meta.type, price: fred.price, change: fred.change, sparkline: [] });
            continue;
          }
          const eia = await fetchOilFromEia(sym);
          if (eia) {
            const meta = META_MAP.get(sym)!;
            console.info(`[Gulf] ${sym} filled from EIA`);
            quotes.push({ symbol: sym, name: meta.name, country: meta.country, flag: meta.flag, type: meta.type, price: eia.price, change: eia.change, sparkline: [] });
          }
        }
      }

      // Safe: read-only snapshot — cachedFetchJson coalesces concurrent calls but
      // memCache is only written after the fetcher resolves, never inside it.
      if (quotes.length === 0 && memCache) return null;
      if (quotes.length === 0) {
        return batch.rateLimited
          ? { quotes: [], rateLimited: true }
          : null;
      }

      return { quotes, rateLimited: false };
    });

    if (result?.quotes?.length) {
      memCache = { data: result, ts: now };
    }

    return result || memCache?.data || { quotes: [], rateLimited: false };
  } catch {
    return memCache?.data || { quotes: [], rateLimited: false };
  }
}
