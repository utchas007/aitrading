import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/ticker?symbols=AAPL,MSFT,NVDA
 * Fetches stock prices from IB (if available) or Yahoo Finance fallback
 */
export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') || [];
  
  if (symbols.length === 0) {
    return NextResponse.json({ success: false, error: 'No symbols provided' }, { status: 400 });
  }

  const results: Record<string, any> = {};

  await Promise.allSettled(
    symbols.map(async (symbol) => {
      const sym = symbol.trim().toUpperCase();
      
      // Try IB first
      try {
        const ibRes = await fetch(`http://localhost:8765/ticker/${sym}?sec_type=STK&exchange=SMART&currency=USD`, {
          signal: AbortSignal.timeout(3000),
        });
        if (ibRes.ok) {
          const data = await ibRes.json();
          if (data.last || data.close) {
            results[sym] = {
              symbol: sym,
              price: data.last || data.close,
              bid: data.bid,
              ask: data.ask,
              volume: data.volume,
              change: null,
              changePercent: null,
              source: 'ib',
              timestamp: data.timestamp,
            };
            return;
          }
        }
      } catch {
        // IB failed, try Yahoo
      }

      // Yahoo Finance fallback
      try {
        const yahooRes = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (yahooRes.ok) {
          const data = await yahooRes.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose || price;
            const change = price - prevClose;
            const changePercent = prevClose > 0 ? ((change / prevClose) * 100) : 0;
            
            results[sym] = {
              symbol: sym,
              price,
              bid: null,
              ask: null,
              volume: meta.regularMarketVolume || null,
              change: change.toFixed(2),
              changePercent: changePercent.toFixed(2),
              prevClose,
              dayHigh: meta.regularMarketDayHigh,
              dayLow: meta.regularMarketDayLow,
              source: 'yahoo',
              timestamp: new Date().toISOString(),
            };
          }
        }
      } catch (e) {
        console.error(`Failed to fetch ${sym}:`, e);
      }
    })
  );

  return NextResponse.json({
    success: true,
    data: results,
    count: Object.keys(results).length,
  });
}
