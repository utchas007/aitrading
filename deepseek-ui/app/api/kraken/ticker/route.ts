import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pairsParam = searchParams.get('pairs');
    
    // Default trading pairs if none specified
    const pairs = pairsParam 
      ? pairsParam.split(',') 
      : ['XXBTZUSD', 'XETHZUSD', 'XLTCZUSD', 'XXRPZUSD']; // BTC, ETH, LTC, XRP

    const kraken = createKrakenClient();
    const ticker = await kraken.getTicker(pairs);

    return NextResponse.json({
      success: true,
      ticker,
    });
  } catch (error: any) {
    console.error('Kraken ticker error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch ticker' },
      { status: 500 }
    );
  }
}
