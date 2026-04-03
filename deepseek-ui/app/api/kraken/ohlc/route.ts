import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pair = searchParams.get('pair') || 'XXBTZCAD';
    const interval = parseInt(searchParams.get('interval') || '60'); // Default 1 hour

    const kraken = createKrakenClient();
    const ohlcData = await kraken.getOHLC(pair, interval);

    // Check if data exists for this pair
    if (!ohlcData || !ohlcData[pair]) {
      return NextResponse.json(
        { success: false, error: `No OHLC data available for ${pair}` },
        { status: 404 }
      );
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
    console.error('OHLC data error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch OHLC data' },
      { status: 500 }
    );
  }
}
