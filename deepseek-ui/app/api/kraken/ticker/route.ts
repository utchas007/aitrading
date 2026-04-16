import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/kraken/ticker');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
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
      log.error('Kraken ticker error', { error: error.message });
      return apiError(error.message || 'Failed to fetch ticker', 'KRAKEN_ERROR');
    }
  });
}
