import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

export async function GET(req: NextRequest) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${IB_SERVICE_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: 'IB service not responding',
        health: {
          connected: false,
          accounts: [],
          market_status: null,
        },
      });
    }

    const health = await res.json();

    return NextResponse.json({
      success: true,
      health: {
        connected: health.connected || false,
        host: health.host,
        port: health.port,
        accounts: health.accounts || [],
        market_status: health.market_status || null,
      },
    });
  } catch (error: any) {
    console.error('IB health check failed:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to connect to IB service',
      health: {
        connected: false,
        accounts: [],
        market_status: null,
      },
    });
  }
}
