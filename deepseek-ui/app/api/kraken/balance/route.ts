import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/kraken/balance');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const kraken = createKrakenClient();
      const balance = await kraken.getBalance();
      const tradeBalance = await kraken.getTradeBalance();

      return NextResponse.json({
        success: true,
        balance,
        totalValue: parseFloat(tradeBalance.eb), // Equivalent balance in CAD
        equity: parseFloat(tradeBalance.e), // Total equity
        tradeBalance: tradeBalance,
      });
    } catch (error: any) {
      log.error('Kraken balance error', { error: error.message });
      return apiError(error.message || 'Failed to fetch balance', 'KRAKEN_ERROR');
    }
  });
}
