import { NextRequest, NextResponse } from 'next/server';
import { createIBClient } from '@/lib/ib-client';

// GET /api/ib/ticker?symbol=AAPL&secType=STK&exchange=SMART&currency=USD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol   = searchParams.get('symbol');
  const secType  = searchParams.get('secType')  ?? 'STK';
  const exchange = searchParams.get('exchange') ?? 'SMART';
  const currency = searchParams.get('currency') ?? 'USD';

  if (!symbol) {
    return NextResponse.json({ success: false, error: 'symbol is required' }, { status: 400 });
  }

  try {
    const ib = createIBClient();
    const ticker = await ib.getTicker(symbol, secType, exchange, currency);
    return NextResponse.json({ success: true, ticker });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
