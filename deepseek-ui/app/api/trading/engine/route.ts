import { NextRequest, NextResponse } from 'next/server';
import { createTradingEngine } from '@/lib/trading-engine';
import { getActivityLogger } from '@/lib/activity-logger';
import { getBotState, setBotRunning, setBotStopped, shouldBotBeRunning } from '@/lib/bot-state';

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
let engineRecoveryAttempted = false;

// Auto-recover bot if it was running before server restart
async function recoverBotIfNeeded() {
  if (engineRecoveryAttempted) return;
  engineRecoveryAttempted = true;
  
  const { should, config } = await shouldBotBeRunning();
  if (should && config && !engineInstance) {
    console.log('[Bot Recovery] Restarting bot that was running before server restart...');
    engineInstance = createTradingEngine({
      pairs:             config.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
      autoExecute:       config.autoExecute ?? true,
      minConfidence:     config.minConfidence ?? 60,
      maxPositions:      config.maxPositions ?? 5,
      riskPerTrade:      config.riskPerTrade ?? 0.05,
      stopLossPercent:   config.stopLossPercent ?? 0.05,
      takeProfitPercent: config.takeProfitPercent ?? 0.10,
      checkInterval:     config.checkInterval ?? 2 * 60 * 1000,
      tradingFeePercent: 0.0005,
      minProfitMargin:   0.02,
      tradeCooldownHours: 4,
      maxDailyTrades:    20,
    });
    engineInstance.start().catch(err => console.error('Bot recovery error:', err));
    console.log('[Bot Recovery] Bot restarted successfully');
  }
}

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

      const botConfig = {
        pairs:             config?.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
        autoExecute:       config?.autoExecute ?? true,
        minConfidence:     config?.minConfidence ?? 60,
        maxPositions:      config?.maxPositions ?? 5,
        riskPerTrade:      config?.riskPerTrade ?? 0.05,
        stopLossPercent:   config?.stopLossPercent ?? 0.05,
        takeProfitPercent: config?.takeProfitPercent ?? 0.10,
        checkInterval:     config?.checkInterval ?? 2 * 60 * 1000,
        tradingFeePercent: 0.0005,
        minProfitMargin:   0.02,
        tradeCooldownHours: 4,
        maxDailyTrades:    20,
      };

      engineInstance = createTradingEngine(botConfig);
      engineInstance.start().catch(err => console.error('Engine start error:', err));
      
      // Persist state to database
      console.log('[Engine Route] About to call setBotRunning...');
      try {
        await setBotRunning(botConfig);
        console.log('[Engine Route] setBotRunning completed');
      } catch (e) {
        console.error('[Engine Route] setBotRunning failed:', e);
      }

      return NextResponse.json({
        success: true,
        message: `Trading engine started — monitoring ${engineInstance.getStatus().config?.pairs?.length ?? 0} stocks`,
        status:  engineInstance.getStatus(),
      });
    }

    if (action === 'stop') {
      if (engineInstance) {
        engineInstance.stop();
        engineInstance = null;
      }
      
      // Persist state to database
      console.log('[Engine Route] About to call setBotStopped...');
      try {
        await setBotStopped();
        console.log('[Engine Route] setBotStopped completed');
      } catch (e) {
        console.error('[Engine Route] setBotStopped failed:', e);
      }
      
      return NextResponse.json({ success: true, message: 'Trading engine stopped' });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Engine control error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET - Get engine status and activities
export async function GET(_req: NextRequest) {
  try {
    // Try standalone bot first
    const botRes = await tryStandaloneBot('/status');
    if (botRes?.ok) {
      return NextResponse.json(await botRes.json());
    }

    // Try to recover bot if it was running before
    await recoverBotIfNeeded();

    // Get persisted state from database
    const dbState = await getBotState();
    
    // Fallback to in-process engine
    const engineStatus = engineInstance?.getStatus();
    const status = {
      isRunning: engineStatus?.isRunning || dbState.isRunning,
      config: engineStatus?.config || dbState.config,
      activePositions: engineStatus?.activePositions || 0,
      startedAt: dbState.startedAt,
    };
    
    // Load activities from database if memory is empty
    const logger = getActivityLogger();
    await logger.loadFromDatabase();
    const activities = logger.getActivities();

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
