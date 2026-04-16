import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/kraken/ohlc');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const pair = searchParams.get('pair') || 'XXBTZCAD';
      const interval = parseInt(searchParams.get('interval') || '60'); // Default 1 hour

      const kraken = createKrakenClient();
      const ohlcData = await kraken.getOHLC(pair, interval);

      // Check if data exists for this pair
      if (!ohlcData || !ohlcData[pair]) {
        return apiError(`No OHLC data available for ${pair}`, 'NOT_FOUND', { status: 404 });
      }

      // Transform Kraken OHLC data to TradingView format
      const candles = ohlcData[pair].map((candle: any[]) => ({
        time: candle[0], // Unix timestamp
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[6]),
      }));

      return NextResponse.json({
        success: true,
        pair,
        interval,
        candles,
        count: candles.length,
      });
    } catch (error: any) {
      log.error('OHLC data error', { error: error.message });
      return apiError(error.message || 'Failed to fetch OHLC data', 'KRAKEN_ERROR');
    }
  });
}
