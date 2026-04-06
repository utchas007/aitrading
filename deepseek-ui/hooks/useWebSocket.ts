'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002';

export interface PriceData {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  volume?: number;
  change?: string;
  changePercent?: string;
  source: 'ib' | 'yahoo';
  timestamp: string;
}

export interface BalanceData {
  NetLiquidation_CAD?: string;
  NetLiquidation_USD?: string;
  AvailableFunds_CAD?: string;
  AvailableFunds_USD?: string;
  BuyingPower_CAD?: string;
  BuyingPower_USD?: string;
  UnrealizedPnL_CAD?: string;
  UnrealizedPnL_USD?: string;
  RealizedPnL_CAD?: string;
  RealizedPnL_USD?: string;
}

export interface PositionData {
  account: string;
  symbol: string;
  sec_type: string;
  position: number;
  avg_cost: number;
}

export interface BotStatus {
  isRunning: boolean;
  config: {
    pairs: string[];
    autoExecute: boolean;
    minConfidence: number;
    checkInterval: number;
  };
  activePositions: number;
}

export interface Activity {
  id?: number;
  type: string;
  message: string;
  pair?: string;
  createdAt?: string;
}

export interface IBHealth {
  connected: boolean;
  accounts: string[];
  market_status: {
    session: string;
    is_open: boolean;
    time_et: string;
  };
}

export interface TradeEvent {
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderId?: number;
  timestamp: string;
}

export interface SignalEvent {
  pair: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reasoning: string;
  timestamp: string;
}

export interface AlertEvent {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
}

export interface WebSocketData {
  prices: Record<string, PriceData>;
  balance: BalanceData | null;
  positions: PositionData[];
  botStatus: BotStatus | null;
  activities: Activity[];
  ibHealth: IBHealth | null;
  connected: boolean;
  lastUpdate: Date | null;
}

export function useWebSocket() {
  const [data, setData] = useState<WebSocketData>({
    prices: {},
    balance: null,
    positions: [],
    botStatus: null,
    activities: [],
    ibHealth: null,
    connected: false,
    lastUpdate: null,
  });

  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Connect to WebSocket server
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WebSocket] Connected to server');
      setData(prev => ({ ...prev, connected: true }));
    });

    socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected from server');
      setData(prev => ({ ...prev, connected: false }));
    });

    socket.on('connect_error', (error) => {
      console.log('[WebSocket] Connection error:', error.message);
    });

    // Data events
    socket.on('prices', (prices: Record<string, PriceData>) => {
      setData(prev => ({
        ...prev,
        prices,
        lastUpdate: new Date(),
      }));
    });

    socket.on('balance', (balance: BalanceData) => {
      setData(prev => ({
        ...prev,
        balance,
        lastUpdate: new Date(),
      }));
    });

    socket.on('positions', (positions: PositionData[]) => {
      setData(prev => ({
        ...prev,
        positions,
        lastUpdate: new Date(),
      }));
    });

    socket.on('botStatus', (botStatus: BotStatus) => {
      setData(prev => ({
        ...prev,
        botStatus,
        lastUpdate: new Date(),
      }));
    });

    socket.on('activities', (activities: Activity[]) => {
      setData(prev => ({
        ...prev,
        activities,
        lastUpdate: new Date(),
      }));
    });

    socket.on('newActivity', (activity: Activity) => {
      setData(prev => ({
        ...prev,
        activities: [activity, ...prev.activities.slice(0, 19)],
        lastUpdate: new Date(),
      }));
    });

    socket.on('ibHealth', (ibHealth: IBHealth) => {
      setData(prev => ({
        ...prev,
        ibHealth,
        lastUpdate: new Date(),
      }));
    });

    // Trade and signal events
    socket.on('trade', (trade: TradeEvent) => {
      setTrades(prev => [trade, ...prev.slice(0, 49)]);
    });

    socket.on('signal', (signal: SignalEvent) => {
      setSignals(prev => [signal, ...prev.slice(0, 49)]);
    });

    socket.on('alert', (alert: AlertEvent) => {
      setAlerts(prev => [alert, ...prev.slice(0, 19)]);
    });

    // Cleanup
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Clear alerts
  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // Dismiss specific alert
  const dismissAlert = useCallback((index: number) => {
    setAlerts(prev => prev.filter((_, i) => i !== index));
  }, []);

  return {
    ...data,
    trades,
    signals,
    alerts,
    clearAlerts,
    dismissAlert,
    socket: socketRef.current,
  };
}

export default useWebSocket;
