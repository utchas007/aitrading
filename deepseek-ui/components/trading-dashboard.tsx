"use client";

import { useState, useEffect } from "react";
import AnalysisPanel from "./analysis-panel";
import { WorldMonitorPanel } from "./worldmonitor-panel";

interface MarketData {
  [pair: string]: {
    a: [string, string, string];
    b: [string, string, string];
    c: [string, string];
    v: [string, string];
    p: [string, string];
    o: string;
  };
}

interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
  category?: string;
}

interface TradingSignal {
  sentiment: string;
  confidence: number;
  signal: string;
  keyFactors: string[];
  risks: string[];
  recommendation: string;
  entryPrice: string | null;
  exitPrice: string | null;
  stopLoss: string | null;
}

export default function TradingDashboard() {
  const [balance, setBalance] = useState<any>(null);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [signal, setSignal] = useState<TradingSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState('XXBTZUSD');
  const [analyzing, setAnalyzing] = useState(false);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [executing, setExecuting] = useState(false);
  const [tradeAmount, setTradeAmount] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<{
    kraken: boolean;
    news: boolean;
  }>({ kraken: false, news: false });

  const pairs = ['XXBTZUSD', 'XETHZUSD', 'XLTCZUSD', 'XXRPZUSD'];

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/kraken/balance');
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  };

  // Fetch market data
  const fetchMarketData = async () => {
    try {
      const res = await fetch(`/api/kraken/ticker?pairs=${pairs.join(',')}`);
      const data = await res.json();
      if (data.success) {
        setMarketData(data.ticker);
      }
    } catch (error) {
      console.error('Failed to fetch market data:', error);
    }
  };

  // Fetch news
  const fetchNews = async () => {
    try {
      const res = await fetch('/api/worldmonitor/news?category=markets&limit=20');
      const data = await res.json();
      if (data.success) {
        setNews(data.news);
      }
    } catch (error) {
      console.error('Failed to fetch news:', error);
    }
  };

  // Analyze trading signal
  const analyzeSignal = async () => {
    if (!marketData || news.length === 0) return;
    
    setAnalyzing(true);
    try {
      const formattedMarketData: any = {};
      Object.entries(marketData).forEach(([pair, data]) => {
        formattedMarketData[pair] = {
          price: data.c[0],
          volume: data.v[1],
        };
      });

      const res = await fetch('/api/trading/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          news: news.slice(0, 10),
          marketData: formattedMarketData,
          pair: selectedPair,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSignal(data.analysis);
      }
    } catch (error) {
      console.error('Failed to analyze signal:', error);
    }
    setAnalyzing(false);
  };

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchBalance(), fetchMarketData(), fetchNews()])
      .finally(() => setLoading(false));

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchBalance(); // Added: Refresh balance too!
      fetchMarketData();
      fetchNews();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const getSignalColor = (signal: string) => {
    if (signal === 'BUY') return '#00ff9f';
    if (signal === 'SELL') return '#ff4d6d';
    return '#ffd60a';
  };

  const getSentimentColor = (sentiment: string) => {
    if (sentiment === 'Bullish') return '#00ff9f';
    if (sentiment === 'Bearish') return '#ff4d6d';
    return '#888';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#080810', color: '#c8d0e0' }}>
        <div>Loading trading dashboard...</div>
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', 'Cascadia Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      minHeight: "100vh",
      padding: "20px",
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 30 }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, marginBottom: 8, color: '#fff' }}>
            AI Trading <span style={{ color: '#00ff9f' }}>Dashboard</span>
          </h1>
          <p style={{ color: '#666', fontSize: 14 }}>Powered by DeepSeek R1 • Kraken Exchange • Worldmonitor News</p>
        </div>

        {/* Market Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 24 }}>
          {marketData && Object.entries(marketData).map(([pair, data]) => (
            <div key={pair} style={{
              background: '#0a0a14',
              border: '1px solid #1a1a2e',
              borderRadius: 12,
              padding: 16,
              cursor: 'pointer',
              transition: 'all 0.2s',
              borderColor: selectedPair === pair ? '#00ff9f' : '#1a1a2e',
            }} onClick={() => setSelectedPair(pair)}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{pair}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>${parseFloat(data.c[0]).toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Vol: {parseFloat(data.v[1]).toFixed(2)}</div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24, alignItems: 'start' }}>
          
          {/* AI Trading Analysis - Auto-updating from bot */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <AnalysisPanel />
          </div>

          {/* Portfolio Balance */}
          <div style={{
            background: '#0a0a14',
            border: '1px solid #1a1a2e',
            borderRadius: 12,
            padding: 20,
            minHeight: 400,
            maxHeight: 600,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Portfolio Balance</h2>
            {balance ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(balance).map(([currency, amount]: [string, any]) => {
                  const value = parseFloat(amount);
                  if (value > 0.0001) {
                    return (
                      <div key={currency} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: 12,
                        background: '#0d0d1e',
                        borderRadius: 8,
                        border: '1px solid #1a1a2e',
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{currency}</span>
                        <span style={{ fontSize: 14, color: '#00ff9f', fontFamily: 'monospace' }}>{value.toFixed(8)}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                <div>Loading balance...</div>
              </div>
            )}
          </div>
        </div>


        {/* News Feed */}
        <div style={{
          background: '#0a0a14',
          border: '1px solid #1a1a2e',
          borderRadius: 12,
          padding: 20,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Market News</h2>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {news.map((item, idx) => (
              <div key={idx} style={{
                padding: 12,
                marginBottom: 12,
                background: '#0d0d1e',
                borderRadius: 8,
                border: '1px solid #1a1a2e',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{item.description}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
                  <span>{item.source}</span>
                  <span>{new Date(item.pubDate).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
