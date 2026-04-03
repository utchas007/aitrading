import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';
    const res = await fetch(`${IB_SERVICE_URL}/market-status`);
    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
