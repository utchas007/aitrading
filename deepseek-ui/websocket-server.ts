/**
 * Standalone WebSocket Server for Real-Time Trading Updates
 * Run with: npx ts-node websocket-server.ts
 * Or: node -r ts-node/register websocket-server.ts
 */

import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';

const PORT = 3002;
const POLL_INTERVAL = 3000; // 3 seconds

// Cache for latest data
const latestData: {
  prices: Record<string, any>;
  balance: Record<string, any> | null;
  positions: any[];
  activities: any[];
  botStatus: any;
  ibHealth: any;
} = {
  prices: {},
  balance: null,
  positions: [],
  activities: [],
  botStatus: null,
  ibHealth: null,
};

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'];

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

async function fetchAndBroadcast(io: SocketIOServer) {
  const baseUrl = 'http://localhost:3001';
  const ibUrl = 'http://localhost:8765';

  try {
    const [pricesRes, balanceRes, positionsRes, engineRes, healthRes] = await Promise.all([
      fetchWithTimeout(`${baseUrl}/api/stocks/ticker?symbols=${WATCHLIST.join(',')}`),
      fetchWithTimeout(`${ibUrl}/balance`),
      fetchWithTimeout(`${ibUrl}/positions`),
      fetchWithTimeout(`${baseUrl}/api/trading/engine`),
      fetchWithTimeout(`${ibUrl}/health`),
    ]);

    // Prices
    if (pricesRes?.success && pricesRes.data) {
      const changed = Object.keys(pricesRes.data).some(
        sym => JSON.stringify(pricesRes.data[sym]) !== JSON.stringify(latestData.prices[sym])
      );
      if (changed) {
        latestData.prices = pricesRes.data;
        io.emit('prices', pricesRes.data);
        console.log(`[WS] Broadcasted prices for ${Object.keys(pricesRes.data).length} symbols`);
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

    // Bot status & activities
    if (engineRes?.success) {
      const status = engineRes.status;
      const activities = engineRes.activities || [];

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
    console.error('[WS] Error fetching data:', error);
  }
}

// Create HTTP server and Socket.IO
const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ['http://localhost:3001', 'http://localhost:3000', '*'],
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send cached data to new client
  if (Object.keys(latestData.prices).length > 0) socket.emit('prices', latestData.prices);
  if (latestData.balance) socket.emit('balance', latestData.balance);
  if (latestData.positions.length > 0) socket.emit('positions', latestData.positions);
  if (latestData.botStatus) socket.emit('botStatus', latestData.botStatus);
  if (latestData.activities.length > 0) socket.emit('activities', latestData.activities.slice(0, 20));
  if (latestData.ibHealth) socket.emit('ibHealth', latestData.ibHealth);

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Start polling
setInterval(() => fetchAndBroadcast(io), POLL_INTERVAL);

// Initial fetch
fetchAndBroadcast(io);

httpServer.listen(PORT, () => {
  console.log('================================================');
  console.log('  WebSocket Server for Real-Time Trading');
  console.log('================================================');
  console.log(`  URL: ws://localhost:${PORT}`);
  console.log(`  Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`  Watchlist: ${WATCHLIST.join(', ')}`);
  console.log('================================================');
});
