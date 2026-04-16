import { NextRequest, NextResponse } from 'next/server';
import { getWorldMonitorSummary, getMarketContextForAI } from '@/lib/worldmonitor-data';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/worldmonitor/summary');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worldmonitor/summary
 * Returns complete World Monitor data summary for trading analysis
 */
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const summary = await getWorldMonitorSummary();
      const aiContext = await getMarketContextForAI();

      return NextResponse.json({
        success: true,
        ...summary,
        aiContext,
      });
    } catch (error: any) {
      log.error('World Monitor summary error', { error: error.message });
      return apiError(error.message, 'EXTERNAL_API_ERROR');
    }
  });
}
