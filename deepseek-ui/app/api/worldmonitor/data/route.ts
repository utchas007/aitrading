import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/worldmonitor/data');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORLDMONITOR_BASE_URL = process.env.WORLDMONITOR_URL || 'http://localhost:3000';

/**
 * Proxy endpoint to fetch World Monitor Finance data
 * This integrates stock indices, commodities, forex, and crypto data into the trading bot
 */
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || 'finance';

    // Fetch finance data from World Monitor's finance variant
    const response = await fetch(`${WORLDMONITOR_BASE_URL}/?variant=finance`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`World Monitor returned ${response.status}`);
    }

    // World Monitor finance variant provides real-time market data
    // The data is embedded in the page and updated via WebSocket
    // For now, we'll return a success indicator and let the frontend
    // embed the World Monitor finance page directly

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      worldmonitor_url: `${WORLDMONITOR_BASE_URL}/?variant=finance`,
      message: 'World Monitor Finance is accessible. Embed the URL in an iframe for real-time data.',
      available_data: {
        stock_indices: ['S&P 500', 'Dow Jones', 'NASDAQ', 'FTSE', 'DAX', 'Nikkei'],
        commodities: ['Oil (WTI)', 'Gold', 'Silver', 'Natural Gas'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CAD'],
        crypto: ['BTC', 'ETH', 'Real-time prices from multiple exchanges'],
      },
    });
  } catch (error: any) {
    log.error('World Monitor finance fetch error', { error: error.message });
    return apiError(error.message, 'SERVICE_UNAVAILABLE', {
      extra: { note: 'World Monitor may not be running on port 3000. Start it with: bash /home/aiminer2/start-worldmonitor-local.sh' },
    });
  }
  });
}
