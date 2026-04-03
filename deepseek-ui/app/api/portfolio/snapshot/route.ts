import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import prisma from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/portfolio/snapshot
 * Save a portfolio snapshot to PostgreSQL
 */
export async function POST(req: NextRequest) {
  try {
    // Fetch current balance and create snapshot
    const kraken = createKrakenClient();
    const balance = await kraken.getBalance();
    const ticker = await kraken.getTicker(['XXBTZCAD', 'XETHZCAD', 'SOLCAD']);

    const cadBalance = parseFloat(balance.ZCAD || '0');
    const btcBalance = parseFloat(balance.XXBT || '0');
    const ethBalance = parseFloat(balance.XETH || '0');
    const solBalance = parseFloat(balance.SOL || '0');
    const ltcBalance = parseFloat(balance.XLTC || '0');
    const xrpBalance = parseFloat(balance.XXRP || '0');

    const btcPrice = ticker['XXBTZCAD'] ? parseFloat(ticker['XXBTZCAD'].c[0]) : 0;
    const ethPrice = ticker['XETHZCAD'] ? parseFloat(ticker['XETHZCAD'].c[0]) : 0;
    const solPrice = ticker['SOLCAD'] ? parseFloat(ticker['SOLCAD'].c[0]) : 0;
    const ltcPrice = 0; // XLTCZCAD not available on Kraken CAD
    const xrpPrice = 0; // XXRPZCAD not available on Kraken CAD

    const totalValue =
      cadBalance +
      btcBalance * btcPrice +
      ethBalance * ethPrice +
      solBalance * solPrice +
      ltcBalance * ltcPrice +
      xrpBalance * xrpPrice;

    // Save to PostgreSQL
    const snapshot = await prisma.portfolioSnapshot.create({
      data: {
        totalValue,
        cadBalance,
        btcBalance,
        ethBalance,
        solBalance,
        ltcBalance,
        xrpBalance,
        btcPrice: btcPrice || null,
        ethPrice: ethPrice || null,
        solPrice: solPrice || null,
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
      { status: 500 }
    );
  }
}
