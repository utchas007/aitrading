#!/usr/bin/env npx tsx
/**
 * Standalone Trading Bot
 * Run this separately from Next.js so it persists across page refreshes
 * 
 * Usage: npx tsx scripts/trading-bot.ts
 * Or:    npm run bot
 */

import '../lib/startup-check'; // Fail fast if required env vars are missing
import { createTradingEngine } from '../lib/trading-engine';
import { getActivityLogger } from '../lib/activity-logger';
import { createLogger } from '../lib/logger';
import { alertEnginecrash } from '../lib/alerting';
import http from 'http';

const log = createLogger('trading-bot');

const CONFIG = {
  pairs: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'],
  autoExecute: true,  // LIVE TRADING
  minConfidence: 75,
  maxPositions: 5,
  riskPerTrade: 0.05,
  stopLossPercent: 0.05,
  takeProfitPercent: 0.10,
  checkInterval: 5 * 60 * 1000, // 5 minutes
  tradingFeePercent: 0.0005,
  minProfitMargin: 0.02,
  tradeCooldownHours: 1,
  maxDailyTrades: 30,
};

const PORT = parseInt(process.env.BOT_PORT ?? '3003', 10);

let engine = createTradingEngine(CONFIG);

// Simple HTTP server for status/control
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // GET /status - Get bot status and activities
  if (req.method === 'GET' && url.pathname === '/status') {
    const status = engine.getStatus();
    const activities = getActivityLogger().getActivities();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      status,
      activities: activities.slice(0, 50),
    }));
    return;
  }

  // POST /control - Start/Stop bot
  if (req.method === 'POST' && url.pathname === '/control') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { action } = JSON.parse(body || '{}');
        
        if (action === 'start') {
          if (!engine.getStatus().isRunning) {
            engine.start().catch(err => log.error('Engine start error', { error: String(err) }));
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Bot started' }));
        } else if (action === 'stop') {
          engine.stop();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Bot stopped' }));
        } else if (action === 'restart') {
          engine.stop();
          engine = createTradingEngine(CONFIG);
          engine.start().catch(err => log.error('Engine start error', { error: String(err) }));
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Bot restarted' }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid action' }));
        }
      } catch (e: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           🤖 TRADING BOT STARTED (STANDALONE)             ║
╠═══════════════════════════════════════════════════════════╣
║  Status API: http://localhost:${PORT}/status                 ║
║  Control:    http://localhost:${PORT}/control                ║
║                                                           ║
║  Stocks: ${CONFIG.pairs.join(', ')}
║  Mode: ${CONFIG.autoExecute ? '🔴 LIVE TRADING' : '⚪ SAFE MODE'}                              ║
║  Interval: ${CONFIG.checkInterval / 1000 / 60} minutes                                  ║
╚═══════════════════════════════════════════════════════════╝
`);
  
  // Auto-start the engine
  engine.start().catch(err => log.error('Engine start error', { error: String(err) }));
});

// Graceful shutdown — close DB connections, drain in-flight requests, exit cleanly
async function gracefulShutdown(signal: string): Promise<void> {
  log.info(`${signal} received — initiating graceful shutdown`);

  // 1. Stop new market cycles from starting
  engine.stop();

  // 2. Stop the HTTP control server from accepting new connections
  server.close(() => {
    log.info('HTTP server closed');
  });

  // 3. Close the Prisma DB connection pool
  try {
    const { prisma } = await import('../lib/db');
    await prisma.$disconnect();
    log.info('Database connection closed');
  } catch (e) {
    log.error('Error closing DB connection', { error: String(e) });
  }

  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT',  () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

// Catch uncaught exceptions so the bot doesn't silently die
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — initiating emergency shutdown', { error: err.message, stack: err.stack });
  // Fire-and-forget: alert first, then exit
  void alertEnginecrash(err).finally(() => {
    engine.stop();
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { reason: String(reason) });
});
