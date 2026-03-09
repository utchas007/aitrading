import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const kraken = createKrakenClient();
    const balance = await kraken.getBalance();

    return NextResponse.json({
      success: true,
      balance,
    });
  } catch (error: any) {
    console.error('Kraken balance error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch balance' },
      { status: 500 }
    );
  }
}
