import { NextRequest, NextResponse } from 'next/server';
import { createIBClient } from '@/lib/ib-client';
import { apiError } from '@/lib/api-response';
import { withCorrelation } from '@/lib/correlation';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const ib = createIBClient();
      const [balance, positions] = await Promise.all([
        ib.getBalance(),
        ib.getPositions(),
      ]);
      return NextResponse.json({ success: true, balance, positions });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}
