/**
 * 
 * Standalone WebSocket Server for Real-Time Trading Updates
 * Run with: npx ts-node websocket-server.ts
 * Or: node -r ts-node/register websocket-server.ts
 */

import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { createLogger } from './lib/logger';

const log = createLogger('websocket-server');

const PORT = parseInt(process.env.WS_PORT ?? '3002', 10);
const POLL_INTERVAL = parseInt(process.env.WS_POLL_INTERVAL_MS ?? '3000', 10);

// Cache for latest data
const latestData: {
  prices: Record<string, any>;
  balance: Record<string, any> | null;
  positions: any[];
  orders: any[];
  activities: any[];
  botStatus: any;
  ibHealth: any;
} = {
  prices: {},
  balance: null,
  positions: [],
  orders: [],
  activities: [],
  botStatus: null,
  ibHealth: null,
};

// Fallback symbols used when the bot is not running or config is unavailable
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'JPM', 'META', 'XOM', 'AMD'];

// Dynamic watchlist — updated each poll cycle from the bot's configured pairs
let currentWatchlist: string[] = [...DEFAULT_WATCHLIST];

async function fetchWithTimeout(url: string, timeout = 5000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(id);
    return null;
  }
}

// Service URLs — configurable via env vars so this works in any environment
const NEXTJS_URL   = process.env.NEXTJS_URL   ?? 'http://localhost:3001';
const IB_SERVICE_URL = process.env.IB_SERVICE_URL ?? 'http://localhost:8765';

async function fetchAndBroadcast(io: SocketIOServer) {
  const baseUrl = NEXTJS_URL;
  const ibUrl   = IB_SERVICE_URL;

  try {
    const [pricesRes, balanceRes, positionsRes, ordersRes, engineRes, healthRes] = await Promise.all([
      fetchWithTimeout(`${baseUrl}/api/stocks/ticker?symbols=${currentWatchlist.join(',')}`),
      fetchWithTimeout(`${ibUrl}/balance`),
      fetchWithTimeout(`${ibUrl}/positions`),
      fetchWithTimeout(`${ibUrl}/orders`),
      fetchWithTimeout(`${baseUrl}/api/trading/engine`),
      fetchWithTimeout(`${ibUrl}/health`),
    ]);

    // Prices — delta update: only broadcast symbols whose price actually changed
    if (pricesRes?.success && pricesRes.data) {
      const delta: Record<string, unknown> = {};
      for (const sym of Object.keys(pricesRes.data)) {
        if (JSON.stringify(pricesRes.data[sym]) !== JSON.stringify(latestData.prices[sym])) {
          delta[sym] = pricesRes.data[sym];
        }
      }
      if (Object.keys(delta).length > 0) {
        // Merge changed symbols into full cache
        latestData.prices = { ...latestData.prices, ...pricesRes.data };
        // Emit only the diff — clients merge delta into their local state
        io.emit('pricesDelta', delta);
        // Also emit full snapshot so late-joining clients get everything
        io.emit('prices', latestData.prices);
        log.debug('Broadcasted price delta', { changed: Object.keys(delta).length });
      }
    }

    // Balance
    if (balanceRes && Object.keys(balanceRes).length > 0) {
      if (JSON.stringify(balanceRes) !== JSON.stringify(latestData.balance)) {
        latestData.balance = balanceRes;
        io.emit('balance', balanceRes);
      }
    }

    // Positions
    if (positionsRes && Array.isArray(positionsRes)) {
      if (JSON.stringify(positionsRes) !== JSON.stringify(latestData.positions)) {
        latestData.positions = positionsRes;
        io.emit('positions', positionsRes);
      }
    }

    // Open orders — emit on any change so UI reflects fills/cancels immediately
    if (ordersRes && Array.isArray(ordersRes)) {
      const openOrders = ordersRes.filter((o: any) => !['Filled', 'Cancelled', 'Inactive'].includes(o.status));
      if (JSON.stringify(openOrders) !== JSON.stringify(latestData.orders)) {
        latestData.orders = openOrders;
        io.emit('orders', openOrders);
      }
    }

    // Bot status & activities
    if (engineRes?.success) {
      const status = engineRes.status;
      const activities = engineRes.activities || [];

      // Sync watchlist with bot's configured pairs
      const botPairs: string[] | undefined = status?.config?.pairs;
      if (botPairs && botPairs.length > 0) {
        const joined = botPairs.slice().sort().join(',');
        const current = currentWatchlist.slice().sort().join(',');
        if (joined !== current) {
          currentWatchlist = botPairs;
          log.info('Watchlist updated from bot config', { pairs: botPairs.join(', ') });
        }
      }

      if (JSON.stringify(status) !== JSON.stringify(latestData.botStatus)) {
        latestData.botStatus = status;
        io.emit('botStatus', status);
      }

      // Check for new activities
      const prevIds = new Set(latestData.activities.slice(0, 5).map((a: any) => a.message));
      const newActivities = activities.slice(0, 5).filter((a: any) => !prevIds.has(a.message));
      
      if (newActivities.length > 0) {
        latestData.activities = activities;
        io.emit('activities', activities.slice(0, 20));
        newActivities.forEach((activity: any) => {
          io.emit('newActivity', activity);
        });
      }
    }

    // IB Health
    if (healthRes) {
      if (JSON.stringify(healthRes) !== JSON.stringify(latestData.ibHealth)) {
        latestData.ibHealth = healthRes;
        io.emit('ibHealth', healthRes);
      }
    }
  } catch (error) {
    log.error('Error fetching data', { error: String(error) });
  }
}

// Create HTTP server and Socket.IO
const httpServer = createServer();
// Build CORS origin list from env (comma-separated) with localhost defaults
const WS_CORS_ORIGINS = (process.env.WS_CORS_ORIGINS ?? 'http://localhost:3001,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: WS_CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  // WebSocket per-message compression (permessage-deflate)
  // Reduces bandwidth for large price/position payloads significantly.
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024, // Only compress payloads > 1KB
  },
  // Ping/pong to detect dead connections and trigger client reconnect
  pingTimeout:  20_000,
  pingInterval: 15_000,
});

// Per-symbol subscriptions: clients send { symbols: ['AAPL', 'MSFT'] } to filter
// their price updates. Default: receive all symbols in the watchlist.
const clientSymbols = new Map<string, Set<string>>();

io.on('connection', (socket) => {
  log.info('Client connected', { id: socket.id });

  // Per-symbol subscription: client can send { symbols: ['AAPL', 'MSFT'] } to filter
  socket.on('subscribe', (data: { symbols?: string[] }) => {
    if (data?.symbols?.length) {
      const syms = new Set(data.symbols.map((s: string) => s.toUpperCase()));
      clientSymbols.set(socket.id, syms);
      log.debug('Client subscribed to symbols', { id: socket.id, symbols: [...syms] });
      // Send current prices filtered to subscribed symbols
      const filtered: Record<string, unknown> = {};
      for (const sym of syms) {
        if (latestData.prices[sym]) filtered[sym] = latestData.prices[sym];
      }
      if (Object.keys(filtered).length > 0) socket.emit('prices', filtered);
    } else {
      clientSymbols.delete(socket.id); // Subscribe to all
    }
  });

  // Send cached data to new client
  if (Object.keys(latestData.prices).length > 0) socket.emit('prices', latestData.prices);
  if (latestData.balance) socket.emit('balance', latestData.balance);
  if (latestData.positions.length > 0) socket.emit('positions', latestData.positions);
  socket.emit('orders', latestData.orders);
  if (latestData.botStatus) socket.emit('botStatus', latestData.botStatus);
  if (latestData.activities.length > 0) socket.emit('activities', latestData.activities.slice(0, 20));
  if (latestData.ibHealth) socket.emit('ibHealth', latestData.ibHealth);

  socket.on('disconnect', () => {
    clientSymbols.delete(socket.id);
    log.info('Client disconnected', { id: socket.id });
  });
});

// Start polling
setInterval(() => fetchAndBroadcast(io), POLL_INTERVAL);

// Initial fetch
fetchAndBroadcast(io);

httpServer.listen(PORT, () => {
  log.info('WebSocket server started', { port: PORT, pollIntervalMs: POLL_INTERVAL, watchlist: currentWatchlist.join(', ') });
});
