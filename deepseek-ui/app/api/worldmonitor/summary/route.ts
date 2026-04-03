import { NextRequest, NextResponse } from 'next/server';
import { getWorldMonitorSummary, getMarketContextForAI } from '@/lib/worldmonitor-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worldmonitor/summary
 * Returns complete World Monitor data summary for trading analysis
 */
export async function GET(req: NextRequest) {
  try {
    const summary = await getWorldMonitorSummary();
    const aiContext = await getMarketContextForAI();

    return NextResponse.json({
      success: true,
      ...summary,
      aiContext,
    });
  } catch (error: any) {
    console.error('World Monitor summary error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
