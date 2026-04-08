#!/usr/bin/env npx tsx
/**
 * Standalone Trading Bot
 * Run this separately from Next.js so it persists across page refreshes
 * 
 * Usage: npx tsx scripts/trading-bot.ts
 * Or:    npm run bot
 */

import { createTradingEngine } from '../lib/trading-engine';
import { getActivityLogger } from '../lib/activity-logger';
import http from 'http';

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

const PORT = 3002;

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
            engine.start().catch(console.error);
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
          engine.start().catch(console.error);
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
  engine.start().catch(console.error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping trading bot...');
  engine.stop();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.stop();
  server.close();
  process.exit(0);
});
