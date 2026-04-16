import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/ib/health');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${IB_SERVICE_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        return apiError('IB service not responding', 'SERVICE_UNAVAILABLE', {
          extra: { health: { connected: false, accounts: [], market_status: null } },
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
      log.error('IB health check failed', { error: error.message });
      return apiError(error.message || 'Failed to connect to IB service', 'SERVICE_UNAVAILABLE', {
        extra: { health: { connected: false, accounts: [], market_status: null } },
      });
    }
  });
}
