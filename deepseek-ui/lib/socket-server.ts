/**
 * WebSocket Server for Real-Time Trading Updates
 * Broadcasts live data to connected dashboard clients
 */

import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';

let io: SocketIOServer | null = null;
let pollingInterval: NodeJS.Timeout | null = null;

// Cache for latest data to send to new connections
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

/**
 * Fetch data from internal APIs
 */
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

/**
 * Fetch all data and broadcast to clients
 */
async function fetchAndBroadcast() {
  if (!io) return;

  const baseUrl = 'http://localhost:3001';
  const ibUrl = 'http://localhost:8765';

  try {
    // Fetch all data in parallel
    const [pricesRes, balanceRes, positionsRes, engineRes, healthRes] = await Promise.all([
      fetchWithTimeout(`${baseUrl}/api/stocks/ticker?symbols=${WATCHLIST.join(',')}`),
      fetchWithTimeout(`${ibUrl}/balance`),
      fetchWithTimeout(`${ibUrl}/positions`),
      fetchWithTimeout(`${baseUrl}/api/trading/engine`),
      fetchWithTimeout(`${ibUrl}/health`),
    ]);

    // Update cache and broadcast prices
    if (pricesRes?.success && pricesRes.data) {
      const priceUpdate = pricesRes.data;
      // Only broadcast if prices changed
      const changed = Object.keys(priceUpdate).some(
        sym => JSON.stringify(priceUpdate[sym]) !== JSON.stringify(latestData.prices[sym])
      );
      if (changed) {
        latestData.prices = priceUpdate;
        io.emit('prices', priceUpdate);
      }
    }

    // Update balance
    if (balanceRes && Object.keys(balanceRes).length > 0) {
      if (JSON.stringify(balanceRes) !== JSON.stringify(latestData.balance)) {
        latestData.balance = balanceRes;
        io.emit('balance', balanceRes);
      }
    }

    // Update positions
    if (positionsRes && Array.isArray(positionsRes)) {
      if (JSON.stringify(positionsRes) !== JSON.stringify(latestData.positions)) {
        latestData.positions = positionsRes;
        io.emit('positions', positionsRes);
      }
    }

    // Update bot status and activities
    if (engineRes?.success) {
      const status = engineRes.status;
      const activities = engineRes.activities || [];
      
      if (JSON.stringify(status) !== JSON.stringify(latestData.botStatus)) {
        latestData.botStatus = status;
        io.emit('botStatus', status);
      }
      
      // Check for new activities
      if (activities.length > 0 && activities[0]?.id !== latestData.activities[0]?.id) {
        // Find new activities
        const existingIds = new Set(latestData.activities.map((a: any) => a.id));
        const newActivities = activities.filter((a: any) => !existingIds.has(a.id));
        
        if (newActivities.length > 0) {
          latestData.activities = activities;
          io.emit('activities', activities.slice(0, 20));
          // Also emit individual new activities for notifications
          newActivities.forEach((activity: any) => {
            io.emit('newActivity', activity);
          });
        }
      }
    }

    // Update IB health
    if (healthRes) {
      if (JSON.stringify(healthRes) !== JSON.stringify(latestData.ibHealth)) {
        latestData.ibHealth = healthRes;
        io.emit('ibHealth', healthRes);
      }
    }
  } catch (error) {
    console.error('[WebSocket] Error fetching data:', error);
  }
}

/**
 * Initialize the WebSocket server
 */
export function initSocketServer(httpServer: any): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ['http://localhost:3001', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Send cached data immediately to new clients
    if (Object.keys(latestData.prices).length > 0) {
      socket.emit('prices', latestData.prices);
    }
    if (latestData.balance) {
      socket.emit('balance', latestData.balance);
    }
    if (latestData.positions.length > 0) {
      socket.emit('positions', latestData.positions);
    }
    if (latestData.botStatus) {
      socket.emit('botStatus', latestData.botStatus);
    }
    if (latestData.activities.length > 0) {
      socket.emit('activities', latestData.activities.slice(0, 20));
    }
    if (latestData.ibHealth) {
      socket.emit('ibHealth', latestData.ibHealth);
    }

    // Handle client requests
    socket.on('subscribe', (channels: string[]) => {
      console.log(`[WebSocket] Client ${socket.id} subscribed to:`, channels);
    });

    socket.on('disconnect', () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
  });

  // Start polling for updates every 3 seconds
  if (!pollingInterval) {
    pollingInterval = setInterval(fetchAndBroadcast, 3000);
    // Initial fetch
    fetchAndBroadcast();
  }

  console.log('[WebSocket] Server initialized');
  return io;
}

/**
 * Get the Socket.IO instance
 */
export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Broadcast a trade execution to all clients
 */
export function broadcastTrade(trade: {
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderId?: number;
}) {
  if (io) {
    io.emit('trade', {
      ...trade,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Broadcast a signal to all clients
 */
export function broadcastSignal(signal: {
  pair: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reasoning: string;
}) {
  if (io) {
    io.emit('signal', {
      ...signal,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Broadcast an alert to all clients
 */
export function broadcastAlert(alert: {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
}) {
  if (io) {
    io.emit('alert', {
      ...alert,
      timestamp: new Date().toISOString(),
    });
  }
}
