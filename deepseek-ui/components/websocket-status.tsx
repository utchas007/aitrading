'use client';

import { useWebSocketContext } from '@/contexts/WebSocketContext';

export default function WebSocketStatus() {
  const { connected, lastUpdate } = useWebSocketContext();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: connected ? '#00ff9f15' : '#ff4d6d15',
      border: `1px solid ${connected ? '#00ff9f40' : '#ff4d6d40'}`,
      borderRadius: 6,
      fontSize: 12,
    }}>
      {/* Status dot */}
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: connected ? '#00ff9f' : '#ff4d6d',
        boxShadow: connected ? '0 0 6px #00ff9f' : '0 0 6px #ff4d6d',
        animation: connected ? 'none' : 'pulse 2s infinite',
      }} />

      <span style={{ color: connected ? '#00ff9f' : '#ff4d6d', fontWeight: 600 }}>
        {connected ? 'Live' : 'Connecting...'}
      </span>

      {connected && lastUpdate && (
        <span style={{ color: '#666', fontSize: 11 }}>
          {lastUpdate.toLocaleTimeString()}
        </span>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
