import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

/**
 * POST /api/portfolio/snapshot
 * Save a portfolio snapshot using IB account balance.
 */
export async function POST(_req: NextRequest) {
  try {
    const res = await fetch(`${IB_SERVICE_URL}/balance`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: 'IB service unavailable' },
        { status: 503 },
      );
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
      return NextResponse.json(
        { success: false, error: 'Could not determine portfolio value from IB balance' },
        { status: 422 },
      );
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
    console.error('Portfolio snapshot error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
