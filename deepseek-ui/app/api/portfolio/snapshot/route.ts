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

    // Prefer USD net liquidation; fall back to CAD
    const totalValueStr =
      balance['NetLiquidation_USD'] ??
      balance['NetLiquidation_CAD'] ??
      balance['NetLiquidation_BASE'] ??
      '0';

    const totalValue = parseFloat(totalValueStr);
    if (!totalValue) {
      return NextResponse.json(
        { success: false, error: 'Could not determine portfolio value from IB balance' },
        { status: 422 },
      );
    }

    const usdCash      = parseFloat(balance['TotalCashValue_USD']  ?? balance['TotalCashValue_CAD']  ?? '0') || null;
    const unrealizedPnl = parseFloat(balance['UnrealizedPnL_USD'] ?? balance['UnrealizedPnL_CAD']  ?? '0') || null;
    const realizedPnl   = parseFloat(balance['RealizedPnL_USD']   ?? balance['RealizedPnL_CAD']    ?? '0') || null;
    const buyingPower   = parseFloat(balance['BuyingPower_USD']    ?? balance['BuyingPower_CAD']    ?? '0') || null;

    const snapshot = await prisma.portfolioSnapshot.create({
      data: {
        totalValue,
        usdCash,
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
