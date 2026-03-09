"use client";

import { useState } from "react";
import LLMControlPanel from "@/components/llm-control-panel";
import TradingDashboard from "@/components/trading-dashboard";
import ActivityFeed from "@/components/activity-feed";

export default function Home() {
  const [view, setView] = useState<'chat' | 'trading'>('chat');

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex' }}>
      {/* Navigation Toggle */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1000,
        display: 'flex',
        gap: 8,
        background: '#0a0a16',
        padding: 8,
        borderRadius: 12,
        border: '1px solid #1a1a2e',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      }}>
        <button
          onClick={() => setView('chat')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid',
            borderColor: view === 'chat' ? '#00ff9f' : '#2a2a4a',
            background: view === 'chat' ? '#00ff9f22' : 'transparent',
            color: view === 'chat' ? '#00ff9f' : '#666',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 0.2s',
          }}
        >
          💬 AI Chat
        </button>
        <button
          onClick={() => setView('trading')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid',
            borderColor: view === 'trading' ? '#00ff9f' : '#2a2a4a',
            background: view === 'trading' ? '#00ff9f22' : 'transparent',
            color: view === 'trading' ? '#00ff9f' : '#666',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 0.2s',
          }}
        >
          📈 Trading
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        {view === 'chat' ? <LLMControlPanel /> : <TradingDashboard />}
      </div>

      {/* Activity Feed Sidebar */}
      <div style={{
        width: 400,
        borderLeft: '1px solid #1a1a2e',
        background: '#080810',
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}>
        <ActivityFeed />
      </div>
    </div>
  );
}
