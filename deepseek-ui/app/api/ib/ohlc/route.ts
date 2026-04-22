import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { TIMEOUTS } from '@/lib/timeouts';
import { withCorrelation } from '@/lib/correlation';

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

// In-memory cache for OHLC data
const ohlcCache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL      = 5 * 60_000; // 5 minutes fresh window
const STALE_CACHE_TTL = 60 * 60_000; // serve stale for up to 1 hour on errors

function getCacheKey(symbol: string, barSize: string, duration: string): string {
  return `${symbol}:${barSize}:${duration}`;
}

function getCachedOHLC(key: string): any | null {
  const cached = ohlcCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  return null;
}

function getStaleCachedOHLC(key: string): any | null {
  const cached = ohlcCache.get(key);
  if (cached && Date.now() - cached.timestamp < STALE_CACHE_TTL) return cached.data;
  return null;
}

function setCachedOHLC(key: string, data: any): void {
  ohlcCache.set(key, { data, timestamp: Date.now() });
}

// Map barSize+duration to Yahoo Finance interval+range
function toYahooParams(barSize: string): { interval: string; range: string } {
  if (barSize.includes('min') || barSize.includes('secs')) {
    const mins = barSize.includes('1 min') ? 1 : barSize.includes('5') ? 5 : barSize.includes('15') ? 15 : 30;
    if (mins <= 5)  return { interval: '5m',  range: '5d' };
    if (mins <= 15) return { interval: '15m', range: '5d' };
    return { interval: '30m', range: '5d' };
  }
  if (barSize.includes('hour')) return { interval: '1h', range: '1mo' };
  if (barSize.includes('day'))  return { interval: '1d', range: '3mo' };
  return { interval: '1d', range: '1mo' };
}

async function fetchFromYahoo(symbol: string, barSize: string) {
  const { interval, range } = toYahooParams(barSize);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' },
    signal: AbortSignal.timeout(TIMEOUTS.HISTORICAL_MS),
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const data = await res.json();

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo Finance');

  const timestamps: number[] = result.timestamp ?? [];
  const quotes = result.indicators?.quote?.[0] ?? {};

  return timestamps.map((ts: number, i: number) => ({
    time: new Date(ts * 1000).toISOString(),
    open:   quotes.open?.[i]   ?? 0,
    high:   quotes.high?.[i]   ?? 0,
    low:    quotes.low?.[i]    ?? 0,
    close:  quotes.close?.[i]  ?? 0,
    volume: quotes.volume?.[i] ?? 0,
  })).filter(b => b.open > 0 && b.close > 0);
}

// GET /api/ib/ohlc?symbol=AAPL&barSize=1+hour&duration=10+D
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    const { searchParams } = new URL(req.url);
    const symbol   = searchParams.get('symbol');
    const secType  = searchParams.get('secType')  ?? 'STK';
    const exchange = searchParams.get('exchange') ?? 'SMART';
    const currency = searchParams.get('currency') ?? 'USD';
    const barSize  = searchParams.get('barSize')  ?? '1 hour';
    const duration = searchParams.get('duration') ?? '10 D';

    if (!symbol) {
      return apiError('symbol is required', 'VALIDATION_ERROR', { status: 400 });
    }

    // Check cache first
    const cacheKey = getCacheKey(symbol, barSize, duration);
    const cached = getCachedOHLC(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    // Try IB first
    try {
      const params = new URLSearchParams({ sec_type: secType, exchange, currency, bar_size: barSize, duration });
      const ibRes = await fetch(`${IB_SERVICE_URL}/ohlc/${symbol}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUTS.HISTORICAL_MS),
      });
      if (ibRes.ok) {
        const bars = await ibRes.json();
        if (Array.isArray(bars) && bars.length > 0) {
          const response = { success: true, bars, source: 'ib' };
          setCachedOHLC(cacheKey, response);
          return NextResponse.json(response);
        }
      }
    } catch { /* fall through to Yahoo */ }

    // Fallback: Yahoo Finance (free, no subscription needed)
    try {
      const bars = await fetchFromYahoo(symbol, barSize);
      const response = { success: true, bars, source: 'yahoo' };
      setCachedOHLC(cacheKey, response);
      return NextResponse.json(response);
    } catch (err: any) {
      // On rate-limit, serve stale cache rather than failing the chart
      if (err.message?.includes('429')) {
        const stale = getStaleCachedOHLC(cacheKey);
        if (stale) return NextResponse.json({ ...stale, stale: true, cached: true });
        return NextResponse.json({ success: true, bars: [], source: 'rate_limited', stale: true });
      }
      return apiError(err.message, 'EXTERNAL_API_ERROR');
    }
  });
}
