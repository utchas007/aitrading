import { NextRequest, NextResponse } from 'next/server';
import { createIBClient } from '@/lib/ib-client';
import { apiError } from '@/lib/api-response';
import { withCorrelation } from '@/lib/correlation';

// GET /api/ib/ticker?symbol=AAPL&secType=STK&exchange=SMART&currency=USD
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    const { searchParams } = new URL(req.url);
    const symbol   = searchParams.get('symbol');
    const secType  = searchParams.get('secType')  ?? 'STK';
    const exchange = searchParams.get('exchange') ?? 'SMART';
    const currency = searchParams.get('currency') ?? 'USD';

    if (!symbol) {
      return apiError('symbol is required', 'VALIDATION_ERROR', { status: 400 });
    }

    try {
      const ib = createIBClient();
      const ticker = await ib.getTicker(symbol, secType, exchange, currency);
      return NextResponse.json({ success: true, ticker });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}
