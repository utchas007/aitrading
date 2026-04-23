import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_BACKTEST_CONFIG, BacktestConfig } from '@/lib/backtest';
import { apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, startDate, endDate, ...overrides } = body as Partial<BacktestConfig> & {
      startDate?: string;
      endDate?: string;
    };

    if (!symbol)    return apiError('symbol is required',    'VALIDATION_ERROR', { status: 400 });
    if (!startDate) return apiError('startDate is required', 'VALIDATION_ERROR', { status: 400 });
    if (!endDate)   return apiError('endDate is required',   'VALIDATION_ERROR', { status: 400 });

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return apiError('startDate and endDate must be valid ISO date strings', 'VALIDATION_ERROR', { status: 400 });
    }
    if (end <= start) {
      return apiError('endDate must be after startDate', 'VALIDATION_ERROR', { status: 400 });
    }

    const config: BacktestConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      ...overrides,
      symbol,
      startDate: start,
      endDate:   end,
    };

    const result = await runBacktest(config);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(msg, 'INTERNAL_ERROR');
  }
}
