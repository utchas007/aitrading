"use client";

import { useState, useEffect } from "react";
import LLMControlPanel from "@/components/llm-control-panel";
import TradingDashboard from "@/components/trading-dashboard";
import ActivityFeed from "@/components/activity-feed";
import CryptoSelector from "@/components/crypto-selector";
import StockSelector from "@/components/stock-selector";
import NotificationBell from "@/components/notification-bell";
import { WorldMonitorPanel } from "@/components/worldmonitor-panel";

type View = 'chat' | 'trading' | 'crypto' | 'stocks' | 'worldmonitor';

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'chat',         label: '💬 AI Chat' },
  { id: 'trading',      label: '📈 Trading' },
  { id: 'crypto',       label: '🪙 Crypto' },
  { id: 'stocks',       label: '🏦 Stocks' },
  { id: 'worldmonitor', label: '🌍 World Monitor' },
];

export default function Home() {
  const [view, setView] = useState<View>('chat');
  const [marketData, setMarketData] = useState<{ fearGreed?: number; fearGreedClass?: string; vix?: number } | null>(null);

  // Fetch market sentiment for header
  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const res = await fetch('/api/market-intelligence?pair=SPY&timeframes=60');
        const data = await res.json();
        if (data.success && data.sentiment) {
          setMarketData({
            fearGreed: data.sentiment.fearGreed?.value,
            fearGreedClass: data.sentiment.fearGreed?.classification,
            vix: data.sentiment.vix?.value,
          });
        }
      } catch {}
    };
    fetchMarket();
    const interval = setInterval(fetchMarket, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  const getFearGreedColor = (value: number) => {
    if (value <= 25) return '#ef4444';
    if (value <= 45) return '#f97316';
    if (value <= 55) return '#eab308';
    if (value <= 75) return '#22c55e';
    return '#10b981';
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @media (max-width: 1200px) {
          .activity-sidebar { width: 320px !important; }
        }
        @media (max-width: 900px) {
          .activity-sidebar { width: 280px !important; }
          .nav-btn { padding: 6px 10px !important; font-size: 11px !important; }
          .market-indicator { font-size: 11px !important; }
        }
        @media (max-width: 768px) {
          .activity-sidebar { display: none !important; }
          .header-bar { flex-wrap: wrap; gap: 8px; padding: 8px 12px !important; }
          .nav-btn { padding: 6px 8px !important; }
        }
      `}</style>
      
      {/* Top Header Bar with Navigation */}
      <div className="header-bar" style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        background: 'linear-gradient(180deg, #0a0a16 0%, #0a0a16ee 100%)',
        borderBottom: '1px solid #1a1a2e',
        padding: '10px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backdropFilter: 'blur(10px)',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        {/* Left: Market Indicators */}
        <div className="market-indicator" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {marketData?.fearGreed !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>😰</span>
              <span style={{ color: getFearGreedColor(marketData.fearGreed), fontWeight: 700, fontSize: 13 }}>
                Fear&Greed: {marketData.fearGreed} ({marketData.fearGreedClass})
              </span>
            </div>
          )}
          {marketData?.vix !== undefined && (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              | VIX: <span style={{ color: marketData.vix > 20 ? '#f97316' : '#22c55e', fontWeight: 600 }}>{marketData.vix.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Right: Navigation + Notifications */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <NotificationBell />
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              className="nav-btn"
              onClick={() => setView(id)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid',
                borderColor: view === id ? '#00ff9f' : '#2a2a4a',
                background: view === id ? '#00ff9f22' : 'transparent',
                color: view === id ? '#00ff9f' : '#888',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {view === 'chat'         && <LLMControlPanel />}
          {view === 'trading'      && <TradingDashboard />}
          {view === 'crypto'       && <CryptoSelector />}
          {view === 'stocks'       && <StockSelector />}
          {view === 'worldmonitor' && <WorldMonitorPanel />}
        </div>

        {/* Activity Feed Sidebar */}
        <div className="activity-sidebar" style={{
          width: 380,
          minWidth: 280,
          maxWidth: '30vw',
          borderLeft: '1px solid #1a1a2e',
          background: '#080810',
          height: 'calc(100vh - 52px)',
          position: 'sticky',
          top: 52,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
