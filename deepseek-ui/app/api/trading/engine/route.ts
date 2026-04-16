import { NextRequest, NextResponse } from 'next/server';
import { createTradingEngine } from '@/lib/trading-engine';
import { getActivityLogger } from '@/lib/activity-logger';
import { getBotState, setBotRunning, setBotStopped, shouldBotBeRunning } from '@/lib/bot-state';
import { apiError } from '@/lib/api-response';
import { TIMEOUTS } from '@/lib/timeouts';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';
import { validate, engineControlSchema } from '@/lib/validation';

const log = createLogger('api/trading/engine');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOT_URL = 'http://localhost:3002';

// Try standalone bot first, fall back to in-process engine
async function tryStandaloneBot(path: string, options?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(`${BOT_URL}${path}`, { ...options, signal: AbortSignal.timeout(TIMEOUTS.BOT_PROBE_MS) });
    return res;
  } catch {
    return null;
  }
}

// Fallback in-process engine (used if standalone bot not running)
let engineInstance: ReturnType<typeof createTradingEngine> | null = null;
let engineRecoveryAttempted = false;

// Mutex: prevents two POST handlers from starting the engine simultaneously
// (race condition if the UI sends two rapid start requests)
let engineStartMutex = false;

// Auto-recover bot if it was running before server restart
async function recoverBotIfNeeded() {
  if (engineRecoveryAttempted) return;
  engineRecoveryAttempted = true;

  // If standalone bot is already alive, don't start a second in-process instance
  const standaloneAlive = await tryStandaloneBot('/status');
  if (standaloneAlive?.ok) {
    log.info('Standalone bot is running — skipping in-process recovery');
    return;
  }

  const { should, config } = await shouldBotBeRunning();
  if (should && config && !engineInstance) {
    log.info('Restarting bot that was running before server restart');
    engineInstance = createTradingEngine({
      pairs:             config.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
      autoExecute:       config.autoExecute ?? false, // default to paper mode on recovery; only live if explicitly saved
      minConfidence:     config.minConfidence ?? 75,
      maxPositions:      config.maxPositions ?? 6,
      riskPerTrade:      config.riskPerTrade ?? 0.05,
      stopLossPercent:   config.stopLossPercent ?? 0.05,
      takeProfitPercent: config.takeProfitPercent ?? 0.10,
      checkInterval:     config.checkInterval ?? 2 * 60 * 1000,
      tradingFeePercent: 0.0005,
      minProfitMargin:   0.02,
      tradeCooldownHours: 1,
      maxDailyTrades:    30,
    });
    engineInstance.start().catch(err => log.error('Bot recovery start error', { error: String(err) }));
    log.info('Bot restarted successfully');
  }
}

// POST - Start/Stop/Control engine
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const rawBody = await req.json();
    const parsed = validate(rawBody, engineControlSchema);
    if ('errorResponse' in parsed) return parsed.errorResponse;
    const { action, config } = parsed.data;

    // Try standalone bot first
    const botRes = await tryStandaloneBot('/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (botRes?.ok) {
      // Standalone accepted the command — stop any in-process instance to prevent duplicates
      if (engineInstance) {
        log.info('Standalone bot took over — stopping in-process engine to prevent duplicate');
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
        return apiError('Standalone bot is already running on port 3002. Stop it first.', 'CONFLICT', { status: 409 });
      }

      if (engineInstance?.getStatus().isRunning) {
        return apiError('Engine is already running', 'CONFLICT', { status: 409 });
      }

      // Mutex guard — prevent duplicate start requests
      if (engineStartMutex) {
        return apiError('Engine start already in progress', 'CONFLICT', { status: 409 });
      }
      engineStartMutex = true;

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

      try {
        engineInstance = createTradingEngine(botConfig);
        engineInstance.start().catch(err => log.error('Engine start error', { error: String(err) }));
      } finally {
        engineStartMutex = false;
      }

      // Persist state to database
      try {
        await setBotRunning(botConfig);
      } catch (e) {
        log.error('setBotRunning failed', { error: String(e) });
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
      try {
        await setBotStopped();
      } catch (e) {
        log.error('setBotStopped failed', { error: String(e) });
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

    return apiError('Invalid action', 'VALIDATION_ERROR', { status: 400 });
  } catch (error: any) {
    log.error('Engine control error', { error: error.message });
    return apiError(error.message, 'INTERNAL_ERROR');
  }
  });
}

// GET - Get engine status and activities
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
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
    
    // Only log meaningful state changes, not every poll
    log.debug('Engine GET status polled', { isRunning: status.isRunning, activePositions: status.activePositions });
    
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
    log.error('Engine status error', { error: error.message });
    return apiError(error.message, 'INTERNAL_ERROR');
  }
  });
}
