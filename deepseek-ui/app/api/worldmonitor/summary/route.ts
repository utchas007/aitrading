import { NextRequest, NextResponse } from 'next/server';
import { getWorldMonitorSummary, getMarketContextForAI } from '@/lib/worldmonitor-data';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/worldmonitor/summary');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      log.error('World Monitor summary error', { error: message });
      return apiError(message, 'EXTERNAL_API_ERROR');
    }
  });
}
