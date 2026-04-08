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
    const res = await fetch(`${BOT_URL}${path}`, { ...options, signal: AbortSignal.timeout(300) });
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

  // If standalone bot is already alive, don't start a second in-process instance
  const standaloneAlive = await tryStandaloneBot('/status');
  if (standaloneAlive?.ok) {
    console.log('[Bot Recovery] Standalone bot is running — skipping in-process recovery');
    return;
  }

  const { should, config } = await shouldBotBeRunning();
  if (should && config && !engineInstance) {
    console.log('[Bot Recovery] Restarting bot that was running before server restart...');
    engineInstance = createTradingEngine({
      pairs:             config.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
      autoExecute:       config.autoExecute ?? false, // default to paper mode on recovery; only live if explicitly saved
      minConfidence:     config.minConfidence ?? 75,
      maxPositions:      config.maxPositions ?? 5,
      riskPerTrade:      config.riskPerTrade ?? 0.05,
      stopLossPercent:   config.stopLossPercent ?? 0.05,
      takeProfitPercent: config.takeProfitPercent ?? 0.10,
      checkInterval:     config.checkInterval ?? 2 * 60 * 1000,
      tradingFeePercent: 0.0005,
      minProfitMargin:   0.02,
      tradeCooldownHours: 1,
      maxDailyTrades:    30,
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
      // Standalone accepted the command — stop any in-process instance to prevent duplicates
      if (engineInstance) {
        console.log('[Engine Route] Standalone bot took over — stopping in-process engine to prevent duplicate');
        engineInstance.stop();
        engineInstance = null;
      }
      const data = await botRes.json();
      const statusRes = await tryStandaloneBot('/status');
      const statusData = statusRes?.ok ? await statusRes.json() : {};
      return NextResponse.json({ ...data, status: statusData.status, activities: statusData.activities });
    }

    // Fallback to in-process engine
    if (action === 'start') {
      // Refuse to start in-process if standalone bot is alive — prevents duplicate instances
      const standaloneAlive = await tryStandaloneBot('/status');
      if (standaloneAlive?.ok) {
        return NextResponse.json({ success: false, error: 'Standalone bot is already running on port 3002. Stop it first.' }, { status: 409 });
      }

      if (engineInstance?.getStatus().isRunning) {
        return NextResponse.json({ success: false, error: 'Engine is already running' });
      }

      const botConfig = {
        pairs:             config?.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
        autoExecute:       config?.autoExecute ?? false, // default to paper mode; user must explicitly enable live trading
        minConfidence:     config?.minConfidence ?? 75,
        maxPositions:      config?.maxPositions ?? 5,
        riskPerTrade:      config?.riskPerTrade ?? 0.05,
        stopLossPercent:   config?.stopLossPercent ?? 0.05,
        takeProfitPercent: config?.takeProfitPercent ?? 0.10,
        checkInterval:     config?.checkInterval ?? 2 * 60 * 1000,
        tradingFeePercent: 0.0005,
        minProfitMargin:   0.02,
        tradeCooldownHours: config?.tradeCooldownHours ?? 1,
        maxDailyTrades:    config?.maxDailyTrades ?? 30,
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
      
      // Return stopped status so UI can immediately update
      return NextResponse.json({ 
        success: true, 
        message: 'Trading engine stopped',
        status: {
          isRunning: false,
          config: null,
          activePositions: 0,
        }
      });
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
    
    // Check in-process engine status
    const engineStatus = engineInstance?.getStatus();
    
    // Engine state takes priority if it exists, otherwise use database state
    const isEngineRunning = engineInstance !== null && engineStatus?.isRunning === true;
    const status = {
      isRunning: isEngineRunning || dbState.isRunning,
      config: engineStatus?.config || dbState.config,
      activePositions: engineStatus?.activePositions || 0,
      startedAt: dbState.startedAt,
    };
    
    console.log('[Engine GET] Status:', { isEngineRunning, dbIsRunning: dbState.isRunning, finalIsRunning: status.isRunning });
    
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
