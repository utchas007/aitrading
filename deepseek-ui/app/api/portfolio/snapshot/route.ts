import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { TIMEOUTS } from '@/lib/timeouts';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/portfolio/snapshot');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

/**
 * POST /api/portfolio/snapshot
 * Save a portfolio snapshot using IB account balance.
 */
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const res = await fetch(`${IB_SERVICE_URL}/balance`, {
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });

    if (!res.ok) {
      return apiError('IB service unavailable', 'SERVICE_UNAVAILABLE', { status: 503 });
    }

    const balance = await res.json();

    // Prefer CAD net liquidation (CAD account); fall back to USD/BASE
    const totalValueStr =
      balance['NetLiquidation_CAD'] ??
      balance['NetLiquidation_USD'] ??
      balance['NetLiquidation_BASE'] ??
      '0';

    const totalValue = parseFloat(totalValueStr);
    if (!totalValue) {
      return apiError('Could not determine portfolio value from IB balance', 'EXTERNAL_API_ERROR', { status: 422 });
    }

    const cadCash       = parseFloat(balance['TotalCashValue_CAD']  ?? balance['TotalCashValue_USD']  ?? '0') || null;

    // Prefer BASE (true account currency) over CAD/USD — IB often returns 0.00 for CAD even when there's a real value
    const unrealizedPnl = parseFloat(balance['UnrealizedPnL_BASE'] ?? balance['UnrealizedPnL_CAD']  ?? balance['UnrealizedPnL_USD'] ?? '0') || null;
    const realizedPnl   = parseFloat(balance['RealizedPnL_BASE']   ?? balance['RealizedPnL_CAD']    ?? balance['RealizedPnL_USD']   ?? '0') || null;
    const buyingPower   = parseFloat(balance['BuyingPower_CAD']     ?? balance['BuyingPower_USD']     ?? '0') || null;

    const snapshot = await prisma.portfolioSnapshot.create({
      data: {
        totalValue,
        cadCash,
        unrealizedPnl,
        realizedPnl,
        buyingPower,
      },
    });

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        totalValue: snapshot.totalValue,
        createdAt: snapshot.createdAt,
      },
    });
  } catch (error: any) {
    log.error('Portfolio snapshot error', { error: error.message });
    return apiError(error.message, 'INTERNAL_ERROR');
  }
  });
}
