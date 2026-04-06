'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useWebSocket, WebSocketData, TradeEvent, SignalEvent, AlertEvent } from '@/hooks/useWebSocket';
import { Socket } from 'socket.io-client';

interface WebSocketContextType extends WebSocketData {
  trades: TradeEvent[];
  signals: SignalEvent[];
  alerts: AlertEvent[];
  clearAlerts: () => void;
  dismissAlert: (index: number) => void;
  socket: Socket | null;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsData = useWebSocket();

  return (
    <WebSocketContext.Provider value={wsData}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}

export default WebSocketContext;
