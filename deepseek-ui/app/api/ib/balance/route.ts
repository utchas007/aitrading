import { NextResponse } from 'next/server';
import { createIBClient } from '@/lib/ib-client';

export async function GET() {
  try {
    const ib = createIBClient();
    const [balance, positions] = await Promise.all([
      ib.getBalance(),
      ib.getPositions(),
    ]);
    return NextResponse.json({ success: true, balance, positions });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
