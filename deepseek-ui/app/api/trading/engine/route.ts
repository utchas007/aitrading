import { NextRequest, NextResponse } from 'next/server';
import { createTradingEngine } from '@/lib/trading-engine';
import { getActivityLogger } from '@/lib/activity-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOT_URL = 'http://localhost:3002';

// Try standalone bot first, fall back to in-process engine
async function tryStandaloneBot(path: string, options?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(`${BOT_URL}${path}`, { ...options, signal: AbortSignal.timeout(2000) });
    return res;
  } catch {
    return null;
  }
}

// Fallback in-process engine (used if standalone bot not running)
let engineInstance: ReturnType<typeof createTradingEngine> | null = null;

// POST - Start/Stop/Control engine
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, config } = body;

    // Try standalone bot first
    const botRes = await tryStandaloneBot('/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (botRes?.ok) {
      const data = await botRes.json();
      // Get status from standalone bot
      const statusRes = await tryStandaloneBot('/status');
      const statusData = statusRes?.ok ? await statusRes.json() : {};
      return NextResponse.json({ ...data, status: statusData.status, activities: statusData.activities });
    }

    // Fallback to in-process engine
    if (action === 'start') {
      if (engineInstance?.getStatus().isRunning) {
        return NextResponse.json({ success: false, error: 'Engine is already running' });
      }

      engineInstance = createTradingEngine({
        pairs:             ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
        autoExecute:       true,
        minConfidence:     75,
        maxPositions:      5,
        riskPerTrade:      0.05,
        stopLossPercent:   0.05,
        takeProfitPercent: 0.10,
        checkInterval:     5 * 60 * 1000,
        tradingFeePercent: 0.0005,
        minProfitMargin:   0.02,
        tradeCooldownHours: 4,
        maxDailyTrades:    20,
        ...config,
      });
      engineInstance.start().catch(err => console.error('Engine start error:', err));

      return NextResponse.json({
        success: true,
        message: `Trading engine started — monitoring ${engineInstance.getStatus().config?.pairs?.length ?? 0} stocks`,
        status:  engineInstance.getStatus(),
      });
    }

    if (action === 'stop') {
      if (!engineInstance) {
        return NextResponse.json({ success: false, error: 'Engine is not running' });
      }
      engineInstance.stop();
      engineInstance = null;
      return NextResponse.json({ success: true, message: 'Trading engine stopped' });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Engine control error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET - Get engine status and activities
export async function GET(req: NextRequest) {
  try {
    // Try standalone bot first
    const botRes = await tryStandaloneBot('/status');
    if (botRes?.ok) {
      return NextResponse.json(await botRes.json());
    }

    // Fallback to in-process engine
    const status = engineInstance?.getStatus() || {
      isRunning: false,
      config: null,
      activePositions: 0,
    };
    const activities = getActivityLogger().getActivities();

    return NextResponse.json({
      success: true,
      status,
      activities: activities.slice(0, 50),
    });
  } catch (error: any) {
    console.error('Engine status error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
