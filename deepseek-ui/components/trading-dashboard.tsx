"use client";

import { useState, useEffect } from "react";
import AnalysisPanel from "./analysis-panel";
import TradingChart from "./trading-chart";
import PortfolioChart from "./portfolio-chart";
import { MarketIntelligencePanel } from "./market-intelligence-panel";

interface IBTicker {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  close: number | null;
  volume: number | null;
  timestamp: string;
  change?: string;
  source?: 'ib' | 'yahoo';
}

interface MarketData {
  [symbol: string]: IBTicker;
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

const DEFAULT_STOCKS = ['AAPL', 'MSFT', 'NVDA', 'TSLA'];

export default function TradingDashboard() {
  const [stocks, setStocks] = useState<string[]>(DEFAULT_STOCKS);
  const [balance, setBalance] = useState<any>(null);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [signal, setSignal] = useState<TradingSignal | null>(null);
  const [, setLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState('AAPL');
  const [analyzing, setAnalyzing] = useState(false);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [executing, setExecuting] = useState(false);
  const [tradeAmount, setTradeAmount] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<{
    ib: boolean;
    ibAccount: string | null;
    ibConnected: boolean;
    marketOpen: boolean;
    news: boolean;
  }>({ ib: false, ibAccount: null, ibConnected: false, marketOpen: false, news: false });
  const [clock, setClock] = useState<{
    utc: string;
    et: string;
    session: string;
    sessionColor: string;
    dot: string;
  }>({ utc: '', et: '', session: '', sessionColor: '#666', dot: '⚪' });

  // Live clock — ticks every second
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const h = etDate.getHours();
      const m = etDate.getMinutes();
      const day = etDate.getDay();
      const isWeekend = day === 0 || day === 6;
      const isPreMarket    = !isWeekend && h >= 4  && (h < 9  || (h === 9  && m < 30));
      const isRegular      = !isWeekend && (h > 9  || (h === 9  && m >= 30)) && h < 16;
      const isAfterHours   = !isWeekend && h >= 16 && h < 20;
      const session = isWeekend      ? 'Market Closed (Weekend)'
        : isPreMarket  ? 'Pre-Market'
        : isRegular    ? 'Market Open'
        : isAfterHours ? 'After Hours'
        : 'Market Closed';
      const sessionColor = isRegular ? '#00ff9f' : isPreMarket || isAfterHours ? '#ffd60a' : '#ff4d6d';
      const dot = isRegular ? '🟢' : isPreMarket || isAfterHours ? '🟡' : '🔴';
      setClock({
        utc: now.toUTCString().replace(' GMT', ' UTC'),
        et: etStr + ' ET',
        session,
        sessionColor,
        dot,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch active pairs from running engine
  const fetchEngineStocks = async () => {
    try {
      const res = await fetch('/api/trading/engine');
      const data = await res.json();
      if (data.success && data.status?.config?.pairs?.length > 0) {
        const pairs: string[] = data.status.config.pairs;
        setStocks(pairs);
        setSelectedPair(prev => pairs.includes(prev) ? prev : pairs[0]);
      }
    } catch {
      // keep defaults
    }
  };

  // Fetch IB connection status
  const fetchIBStatus = async () => {
    try {
      const res = await fetch('/api/ib/health');
      const data = await res.json();
      if (data.success && data.health) {
        setConnectionStatus(prev => ({
          ...prev,
          ib: true,
          ibConnected: data.health.connected,
          ibAccount: data.health.accounts?.[0] || null,
          marketOpen: data.health.market_status?.is_open || false,
        }));
      } else {
        setConnectionStatus(prev => ({ ...prev, ib: false, ibConnected: false, ibAccount: null }));
      }
    } catch (error) {
      console.error('Failed to fetch IB status:', error);
      setConnectionStatus(prev => ({ ...prev, ib: false, ibConnected: false, ibAccount: null }));
    }
  };

  // Fetch IB account balance
  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/ib/balance');
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance);
      }
    } catch (error) {
      console.error('Failed to fetch IB balance:', error);
    }
  };

  // Fetch market data from IB for each stock
  const fetchMarketData = async (currentStocks: string[] = stocks) => {
    try {
      // Use our proxy API that handles IB + Yahoo fallback
      const res = await fetch(`/api/stocks/ticker?symbols=${currentStocks.join(',')}`);
      const json = await res.json();
      
      if (json.success && json.data) {
        const data: MarketData = {};
        Object.entries(json.data).forEach(([symbol, ticker]: [string, any]) => {
          data[symbol] = {
            symbol,
            last: ticker.price,
            close: ticker.prevClose || ticker.price,
            bid: ticker.bid,
            ask: ticker.ask,
            volume: ticker.volume,
            change: ticker.changePercent,
            source: ticker.source,
            timestamp: ticker.timestamp,
          };
        });
        setMarketData(data);
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
        setConnectionStatus(prev => ({ ...prev, news: true }));
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
      Object.entries(marketData).forEach(([symbol, ticker]) => {
        formattedMarketData[symbol] = {
          price: ticker.last ?? ticker.close ?? 0,
          volume: ticker.volume ?? 0,
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

  // Initial load — all fetches in parallel; engine stocks updates the list when ready
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchEngineStocks(),
      fetchIBStatus(),
      fetchBalance(),
      fetchMarketData(),
      fetchNews(),
    ]).finally(() => setLoading(false));

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchEngineStocks();
      fetchIBStatus();
      fetchBalance();
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

  const getPrice = (ticker: IBTicker): number => ticker.last ?? ticker.close ?? 0;

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', 'Cascadia Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      minHeight: "calc(100vh - 52px)",
      padding: "20px",
      overflow: "auto",
    }}>
      <style>{`
        @media (max-width: 1200px) {
          .dashboard-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .dashboard-header { flex-direction: column !important; align-items: flex-start !important; }
          .dashboard-header h1 { font-size: 24px !important; }
        }
      `}</style>
      <div style={{ maxWidth: 1600, margin: '0 auto', width: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, marginBottom: 8, color: '#fff' }}>
              AI Trading <span style={{ color: '#00ff9f' }}>Dashboard</span>
            </h1>
            <p style={{ color: '#666', fontSize: 14 }}>Powered by DeepSeek R1 • Interactive Brokers • Worldmonitor News</p>
            
            {/* IB Connection Status Indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 12,
              padding: '8px 16px',
              background: connectionStatus.ibConnected ? '#00ff9f15' : '#ff4d6d15',
              border: `1px solid ${connectionStatus.ibConnected ? '#00ff9f40' : '#ff4d6d40'}`,
              borderRadius: 8,
              width: 'fit-content',
            }}>
              {/* IB Connection Dot */}
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: connectionStatus.ibConnected ? '#00ff9f' : '#ff4d6d',
                boxShadow: connectionStatus.ibConnected ? '0 0 8px #00ff9f' : '0 0 8px #ff4d6d',
                animation: connectionStatus.ibConnected ? 'none' : 'pulse 2s infinite',
              }} />
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: connectionStatus.ibConnected ? '#00ff9f' : '#ff4d6d',
                  }}>
                    {connectionStatus.ibConnected ? '✅ Interactive Brokers Connected' : '❌ IB Disconnected'}
                  </span>
                </div>
                {connectionStatus.ibConnected && connectionStatus.ibAccount && (
                  <span style={{ fontSize: 11, color: '#888' }}>
                    Account: {connectionStatus.ibAccount} {connectionStatus.marketOpen ? '• Market Open' : '• Market Closed'}
                  </span>
                )}
                {!connectionStatus.ibConnected && (
                  <span style={{ fontSize: 11, color: '#666' }}>
                    Start TWS/Gateway and run ib_service.py
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Live Clock & Market Session */}
          <div style={{
            background: '#0a0a14',
            border: `1px solid ${clock.sessionColor}40`,
            borderRadius: 12,
            padding: '12px 20px',
            minWidth: 220,
            textAlign: 'right',
          }}>
            {/* Session badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>{clock.dot}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: clock.sessionColor, letterSpacing: 1 }}>
                {clock.session}
              </span>
            </div>
            {/* ET time — large */}
            <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', fontFamily: 'monospace', letterSpacing: 2, marginBottom: 2 }}>
              {clock.et}
            </div>
            {/* UTC time — small */}
            <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>
              {clock.utc}
            </div>
          </div>
        </div>

        {/* Price Chart */}
        <div style={{
          background: '#0a0a14',
          border: '1px solid #1a1a2e',
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Price Chart</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {stocks.map((s: string) => (
                <button
                  key={s}
                  onClick={() => setSelectedPair(s)}
                  style={{
                    padding: '6px 12px',
                    background: selectedPair === s ? '#00ff9f' : '#1a1a2e',
                    color: selectedPair === s ? '#000' : '#c8d0e0',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <TradingChart pair={selectedPair} interval={60} height={500} />
        </div>

        {/* Market Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 24 }}>
          {stocks.map((symbol: string) => {
            const ticker = marketData?.[symbol];
            const price = ticker ? getPrice(ticker) : null;
            return (
              <div key={symbol} style={{
                background: '#0a0a14',
                border: '1px solid #1a1a2e',
                borderRadius: 12,
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.2s',
                borderColor: selectedPair === symbol ? '#00ff9f' : '#1a1a2e',
              }} onClick={() => setSelectedPair(symbol)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#666' }}>{symbol}</span>
                  {ticker?.source === 'yahoo' && <span style={{ fontSize: 9, color: '#444', background: '#1a1a2e', padding: '2px 6px', borderRadius: 4 }}>YAHOO</span>}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                  {price != null ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#666' }}>Vol: {ticker?.volume != null ? (ticker.volume / 1e6).toFixed(1) + 'M' : '—'}</span>
                  {ticker?.change && (
                    <span style={{ color: parseFloat(ticker.change) >= 0 ? '#00ff9f' : '#ff4d6d', fontWeight: 600 }}>
                      {parseFloat(ticker.change) >= 0 ? '▲' : '▼'} {Math.abs(parseFloat(ticker.change)).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Main Content Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24, alignItems: 'start' }}>

          {/* AI Trading Analysis */}
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
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Portfolio Balance</h2>

            {balance ? (
              <>
                {/* Net Liquidation Value */}
                <div style={{
                  background: 'linear-gradient(135deg, #00ff9f20 0%, #0066ff20 100%)',
                  border: '2px solid #00ff9f',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, color: '#00ff9f', marginBottom: 8, fontWeight: 600 }}>NET LIQUIDATION VALUE</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                    ${parseFloat(balance['NetLiquidation_USD'] ?? balance['NetLiquidation_CAD'] ?? balance['NetLiquidation_BASE'] ?? '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    {balance['NetLiquidation_USD'] ? 'USD' : balance['NetLiquidation_CAD'] ? 'CAD' : 'BASE'} (Interactive Brokers Paper)
                  </div>
                </div>

                {/* Portfolio History Chart */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>PORTFOLIO HISTORY</div>
                  <PortfolioChart height={200} />
                </div>

                {/* Key Metrics */}
                <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>ACCOUNT METRICS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['Available Funds', balance['AvailableFunds_USD'] ?? balance['AvailableFunds_CAD'] ?? balance['AvailableFunds_BASE']],
                    ['Buying Power',    balance['BuyingPower_USD']    ?? balance['BuyingPower_CAD']    ?? balance['BuyingPower_BASE']],
                    ['Unrealized P&L',  balance['UnrealizedPnL_USD']  ?? balance['UnrealizedPnL_CAD']  ?? balance['UnrealizedPnL_BASE']],
                    ['Realized P&L',    balance['RealizedPnL_USD']    ?? balance['RealizedPnL_CAD']    ?? balance['RealizedPnL_BASE']],
                  ].filter(([, v]) => v != null).map(([label, value]) => (
                    <div key={label as string} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: '#0d0d1e',
                      borderRadius: 8,
                      border: '1px solid #1a1a2e',
                    }}>
                      <span style={{ fontSize: 13, color: '#888' }}>{label}</span>
                      <span style={{ fontSize: 13, color: '#00ff9f', fontFamily: 'monospace' }}>
                        ${parseFloat(value as string).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                <div>Loading balance...</div>
                <div style={{ fontSize: 12, marginTop: 8 }}>Make sure IB service is running (python ib_service.py)</div>
              </div>
            )}
          </div>
        </div>

        {/* Market Intelligence Panel */}
        <div style={{ marginBottom: 24 }}>
          <MarketIntelligencePanel pair={selectedPair} />
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
