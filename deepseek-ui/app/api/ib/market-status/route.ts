import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { withCorrelation } from '@/lib/correlation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';
      const res = await fetch(`${IB_SERVICE_URL}/market-status`);
      const data = await res.json();
      return NextResponse.json({ success: true, ...data });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}
