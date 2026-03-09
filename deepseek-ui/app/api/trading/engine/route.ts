import { NextRequest, NextResponse } from 'next/server';
import { createTradingEngine } from '@/lib/trading-engine';
import { getActivityLogger, logActivity } from '@/lib/activity-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Global engine instance
let engineInstance: ReturnType<typeof createTradingEngine> | null = null;

// Auto-start the bot when server starts
if (!engineInstance) {
  logActivity.info('🚀 Server started - Initializing trading bot...');
  engineInstance = createTradingEngine({
    pairs: [
      // Only Bitcoin - the most liquid and stable pair on Kraken
      'XXBTZCAD',
      // Note: All other CAD pairs have issues with historical data or unknown asset pair errors
      // Focusing on BTC only ensures stable, error-free operation
      // This is sufficient for testing and demonstrating the AI trading system
    ],
    autoExecute: true, // LIVE TRADING ENABLED!
    minConfidence: 75,
    maxPositions: 5, // Increased for more opportunities
    riskPerTrade: 0.20, // 20% per trade (spread across more assets)
    checkInterval: 5 * 60 * 1000, // 5 minutes
  });
  
  // Start the engine automatically
  engineInstance.start().then(() => {
    logActivity.completed('✅ Trading bot started automatically and running 24/7!');
  }).catch((error) => {
    logActivity.error(`❌ Failed to auto-start bot: ${error.message}`);
  });
}

// POST - Start/Stop/Control engine
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, config } = body;

    if (action === 'start') {
      if (engineInstance?.getStatus().isRunning) {
        return NextResponse.json({
          success: false,
          error: 'Engine is already running',
        });
      }

      engineInstance = createTradingEngine(config);
      await engineInstance.start();

      return NextResponse.json({
        success: true,
        message: 'Trading engine started',
        status: engineInstance.getStatus(),
      });
    }

    if (action === 'stop') {
      if (!engineInstance) {
        return NextResponse.json({
          success: false,
          error: 'Engine is not running',
        });
      }

      engineInstance.stop();
      engineInstance = null;

      return NextResponse.json({
        success: true,
        message: 'Trading engine stopped',
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action. Use "start" or "stop"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Engine control error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET - Get engine status and activities
export async function GET(req: NextRequest) {
  try {
    const status = engineInstance?.getStatus() || {
      isRunning: false,
      config: null,
      activePositions: 0,
    };

    const activities = getActivityLogger().getActivities();

    return NextResponse.json({
      success: true,
      status,
      activities: activities.slice(0, 50), // Last 50 activities
    });
  } catch (error: any) {
    console.error('Engine status error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
