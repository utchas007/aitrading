/**
 * RPC: ListCommodityQuotes
 * Fetches commodity futures quotes from Yahoo Finance with FRED/EIA fallbacks.
 * Fallback chain: Yahoo → FRED → EIA → in-memory cache
 */

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { fetchYahooQuotesBatch, parseStringArray } from './_shared';
import { cachedFetchJson, getCachedJson } from '../../../_shared/redis';

const REDIS_CACHE_KEY = 'market:commodities:v1';
const REDIS_CACHE_TTL = 600;

const fallbackCommodityCache = new Map<string, { data: ListCommodityQuotesResponse; ts: number }>();

function redisCacheKey(symbols: string[]): string {
  return `${REDIS_CACHE_KEY}:${[...symbols].sort().join(',')}`;
}

// ── FRED series IDs for each Yahoo commodity symbol ───────────────────────────
// Note: Gold (GOLDPMGBD228NLBM) and Silver (SLVPRUSD) FRED series are discontinued —
// those symbols rely on Yahoo Finance only.
const FRED_SERIES: Record<string, { seriesId: string; name: string; display: string }> = {
  'CL=F': { seriesId: 'DCOILWTICO',   name: 'WTI Crude',   display: 'WTI Oil' },
  'BZ=F': { seriesId: 'DCOILBRENTEU', name: 'Brent Crude', display: 'Brent'   },
  'NG=F': { seriesId: 'MHHNGSP',      name: 'Natural Gas', display: 'Nat Gas' },
  'HG=F': { seriesId: 'PCOPPUSDM',    name: 'Copper',      display: 'Copper'  },
};

// ── EIA series IDs (energy only, more real-time than FRED) ───────────────────
const EIA_PATHS: Record<string, { path: string; facet: string; name: string; display: string }> = {
  'CL=F': { path: '/v2/petroleum/pri/spt/data/', facet: 'RWTC',  name: 'WTI Crude',   display: 'WTI Oil' },
  'BZ=F': { path: '/v2/petroleum/pri/spt/data/', facet: 'RBRTE', name: 'Brent Crude', display: 'Brent'   },
};

async function fetchFredQuote(symbol: string): Promise<CommodityQuote | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  const meta = FRED_SERIES[symbol];
  if (!meta) return null;

  try {
    const params = new URLSearchParams({
      series_id:        meta.seriesId,
      api_key:          apiKey,
      file_type:        'json',
      sort_order:       'desc',
      observation_start: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
      limit:            '5',
    });
    const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { observations: Array<{ value: string; date: string }> };
    const obs = data.observations?.filter(o => o.value !== '.') ?? [];
    if (obs.length < 1) return null;

    const latestObs = obs[0];
    if (!latestObs) return null;
    const price  = parseFloat(latestObs.value);
    const prevObs = obs.length > 1 ? obs[1] : latestObs;
    const prev   = prevObs ? parseFloat(prevObs.value) : price;
    const change = price && prev ? ((price - prev) / prev) * 100 : 0;

    return { symbol, name: meta.name, display: meta.display, price, change, sparkline: [] };
  } catch {
    return null;
  }
}

async function fetchEiaQuote(symbol: string): Promise<CommodityQuote | null> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) return null;
  const meta = EIA_PATHS[symbol];
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
    const res = await fetch(`https://api.eia.gov${meta.path}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response: { data: Array<{ value: number; period: string }> } };
    const rows = data?.response?.data ?? [];
    if (!rows.length) return null;

    const latestRow = rows[0];
    if (!latestRow) return null;
    const price  = latestRow.value;
    const prevRow = rows.length > 1 ? rows[1] : latestRow;
    const prev   = prevRow ? prevRow.value : price;
    const change = price && prev ? ((price - prev) / prev) * 100 : 0;

    return { symbol, name: meta.name, display: meta.display, price, change, sparkline: [] };
  } catch {
    return null;
  }
}

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  const symbols = parseStringArray(req.symbols);
  if (!symbols.length) return { quotes: [] };

  // Layer 0: bootstrap/seed data
  try {
    const bootstrap = await getCachedJson('market:commodities-bootstrap:v1', true) as ListCommodityQuotesResponse | null;
    if (bootstrap?.quotes?.length) {
      const symbolSet = new Set(symbols);
      const filtered = bootstrap.quotes.filter((q: CommodityQuote) => symbolSet.has(q.symbol));
      if (filtered.length > 0) return { quotes: filtered };
    }
  } catch {}

  const redisKey = redisCacheKey(symbols);

  try {
    const result = await cachedFetchJson<ListCommodityQuotesResponse>(redisKey, REDIS_CACHE_TTL, async () => {
      // Layer 1: Yahoo Finance
      const batch = await fetchYahooQuotesBatch(symbols);
      const quotes: CommodityQuote[] = [];
      const missing: string[] = [];

      for (const s of symbols) {
        const yahoo = batch.results.get(s);
        if (yahoo) {
          quotes.push({ symbol: s, name: s, display: s, price: yahoo.price, change: yahoo.change, sparkline: yahoo.sparkline });
        } else {
          missing.push(s);
        }
      }

      // Layer 2: FRED fallback for symbols Yahoo missed
      if (missing.length > 0) {
        const fredResults = await Promise.allSettled(missing.map(s => fetchFredQuote(s)));
        const eiaSymbols: string[] = [];

        for (const [i, r] of fredResults.entries()) {
          const symbol = missing[i];
          if (!symbol) continue;
          if (r.status === 'fulfilled' && r.value) {
            quotes.push(r.value);
          } else {
            eiaSymbols.push(symbol);
          }
        }

        // Layer 3: EIA fallback for energy symbols FRED also missed
        if (eiaSymbols.length > 0) {
          const eiaResults = await Promise.allSettled(eiaSymbols.map(s => fetchEiaQuote(s)));
          for (const r of eiaResults) {
            if (r.status === 'fulfilled' && r.value) quotes.push(r.value);
          }
        }
      }

      return quotes.length > 0 ? { quotes } : null;
    });

    if (result) {
      if (fallbackCommodityCache.size > 50) fallbackCommodityCache.clear();
      fallbackCommodityCache.set(redisKey, { data: result, ts: Date.now() });
    }
    return result || fallbackCommodityCache.get(redisKey)?.data || { quotes: [] };
  } catch {
    return fallbackCommodityCache.get(redisKey)?.data || { quotes: [] };
  }
}
