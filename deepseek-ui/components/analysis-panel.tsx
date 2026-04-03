"use client";

import { useState, useEffect } from "react";

interface Activity {
  id: string;
  type: 'info' | 'warning' | 'error' | 'completed' | 'analyzing' | 'calculating' | 'executing';
  message: string;
  timestamp: number;
}

interface AnalysisData {
  pair: string;
  action: string;
  confidence: number;
  rsi: number;
  macd: string;
  reasoning: string;
  timestamp: number;
}

export default function AnalysisPanel() {
  const [latestAnalysis, setLatestAnalysis] = useState<AnalysisData | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisData[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tradingMode, setTradingMode] = useState<{ autoExecute: boolean; isRunning: boolean } | null>(null);

  // Fetch bot activities and parse for analysis data
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch('/api/trading/engine');
        const data = await res.json();
        
        if (data.success) {
          // Update trading mode status
          if (data.status && data.status.config) {
            setTradingMode({
              autoExecute: data.status.config.autoExecute,
              isRunning: data.status.isRunning
            });
          }
          
          if (data.activities) {
            setActivities(data.activities);
            
            // Parse activities to extract analysis data
            const analyses: AnalysisData[] = [];
            let currentAnalysis: Partial<AnalysisData> = {};
            
            data.activities.forEach((activity: Activity) => {
            const msg = activity.message;
            
            // Extract pair being analyzed (stocks like AAPL, MSFT or crypto like XXBTZCAD)
            if (msg.includes('Analyzing')) {
              // Match stock symbols (AAPL, MSFT, etc.) or crypto pairs
              const stockMatch = msg.match(/Analyzing\s+([A-Z]{1,5})/);
              const cryptoMatch = msg.match(/(XX[A-Z]+CAD|XX[A-Z]+USD|X[A-Z]+USD)/);
              const pair = stockMatch?.[1] || cryptoMatch?.[1];
              if (pair) {
                currentAnalysis = { pair, timestamp: activity.timestamp };
              }
            }
            
            // Extract technical indicators (format: "AAPL: RSI 49.4, MACD bullish, Confidence 59%")
            if (msg.includes('RSI') && msg.includes('MACD') && msg.includes('Confidence')) {
              const techMatch = msg.match(/([A-Z]{1,5}):\s*RSI\s+([\d.]+),\s*MACD\s+(\w+),\s*Confidence\s+(\d+)%/);
              if (techMatch) {
                const [, pair, rsi, macd, conf] = techMatch;
                // Store for later use or update existing
                if (!currentAnalysis.pair) currentAnalysis.pair = pair;
                currentAnalysis.rsi = parseFloat(rsi);
                currentAnalysis.macd = macd;
                currentAnalysis.confidence = parseInt(conf);
                currentAnalysis.timestamp = activity.timestamp;
              }
            }
            
            // Extract signal and reasoning (format: "AAPL: HOLD | Confidence: 59% | reasoning")
            if (msg.includes(': HOLD') || msg.includes(': BUY') || msg.includes(': SELL')) {
              const signalMatch = msg.match(/([A-Z]{1,5}):\s*(BUY|SELL|HOLD)\s*\|\s*Confidence:\s*(\d+)%/);
              if (signalMatch) {
                const [, pair, action, confidence] = signalMatch;
                currentAnalysis.pair = pair;
                currentAnalysis.action = action;
                currentAnalysis.confidence = parseInt(confidence);
                
                // Extract reasoning from message
                const parts = msg.split('|');
                if (parts.length > 2) {
                  currentAnalysis.reasoning = parts.slice(2).join('|').trim();
                } else {
                  currentAnalysis.reasoning = msg;
                }
                
                // Complete analysis - push it
                if (currentAnalysis.pair && currentAnalysis.action) {
                  analyses.push(currentAnalysis as AnalysisData);
                  currentAnalysis = {};
                }
              }
            }
          });
          
          if (analyses.length > 0) {
            setLatestAnalysis(analyses[0]);
            setAnalysisHistory(analyses.slice(0, 10));
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch activities:', error);
      }
    };

    fetchActivities();
    const interval = setInterval(fetchActivities, 3000); // Update every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const getSignalColor = (action: string) => {
    if (action === 'BUY') return '#00ff9f';
    if (action === 'SELL') return '#ff4d6d';
    return '#ffd60a';
  };

  const getRSIStatus = (rsi: number) => {
    if (rsi < 30) return { status: 'Oversold', color: '#00ff9f', icon: '✅' };
    if (rsi > 70) return { status: 'Overbought', color: '#ff4d6d', icon: '⚠️' };
    return { status: 'Neutral', color: '#888', icon: '⚪' };
  };

  const getMACDStatus = (macd: string) => {
    if (macd === 'bullish') return { status: 'Bullish', color: '#00ff9f', icon: '✅' };
    if (macd === 'bearish') return { status: 'Bearish', color: '#ff4d6d', icon: '⚠️' };
    return { status: 'Neutral', color: '#888', icon: '⚪' };
  };

  if (!latestAnalysis) {
    return (
      <div style={{
        background: '#0a0a14',
        border: '1px solid #1a1a2e',
        borderRadius: 12,
        padding: 20,
        height: '100%',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>
            AI Trading Analysis
          </h2>
          
          {/* Trading Mode Indicator */}
          {tradingMode && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: tradingMode.autoExecute ? '#ff4d6d15' : '#ffd60a15',
              border: `1px solid ${tradingMode.autoExecute ? '#ff4d6d44' : '#ffd60a44'}`,
              borderRadius: 6,
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a',
                boxShadow: `0 0 8px ${tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a'}`,
                animation: 'pulse 2s infinite',
              }} />
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                {tradingMode.autoExecute ? 'LIVE TRADING' : 'SAFE MODE'}
              </span>
            </div>
          )}
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>

        <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14 }}>Waiting for bot analysis...</div>
          <div style={{ fontSize: 12, marginTop: 8, color: '#444' }}>
            Bot checks markets every 5 minutes
          </div>
        </div>
      </div>
    );
  }

  const rsiStatus = getRSIStatus(latestAnalysis.rsi || 50);
  const macdStatus = getMACDStatus(latestAnalysis.macd || 'neutral');

  return (
    <div style={{
      background: '#0a0a14',
      border: '1px solid #1a1a2e',
      borderRadius: 12,
      padding: 20,
      minHeight: 400,
      maxHeight: 600,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>
          AI Trading Analysis
        </h2>
        
        {/* Trading Mode Indicator */}
        {tradingMode && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: tradingMode.autoExecute ? '#ff4d6d15' : '#ffd60a15',
            border: `1px solid ${tradingMode.autoExecute ? '#ff4d6d44' : '#ffd60a44'}`,
            borderRadius: 6,
          }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a',
              boxShadow: `0 0 8px ${tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a'}`,
              animation: 'pulse 2s infinite',
            }} />
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: tradingMode.autoExecute ? '#ff4d6d' : '#ffd60a',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>
              {tradingMode.autoExecute ? 'LIVE TRADING' : 'SAFE MODE'}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Latest Analysis */}
      <div style={{
        background: '#0d0d1e',
        border: '1px solid #1a1a2e',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{latestAnalysis.pair}</div>
            <div style={{ fontSize: 11, color: '#666' }}>
              {new Date(latestAnalysis.timestamp).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: getSignalColor(latestAnalysis.action) }}>
              {latestAnalysis.action}
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>
              {latestAnalysis.confidence}% confidence
            </div>
          </div>
        </div>

        {/* Technical Indicators */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>TECHNICAL INDICATORS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#c8d0e0' }}>RSI</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#fff', fontFamily: 'monospace' }}>
                  {latestAnalysis.rsi?.toFixed(1) || 'N/A'}
                </span>
                <span style={{ fontSize: 11, color: rsiStatus.color }}>
                  {rsiStatus.icon} {rsiStatus.status}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#c8d0e0' }}>MACD</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#fff', textTransform: 'capitalize' }}>
                  {latestAnalysis.macd || 'N/A'}
                </span>
                <span style={{ fontSize: 11, color: macdStatus.color }}>
                  {macdStatus.icon} {macdStatus.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Reasoning */}
        <div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>REASONING</div>
          <div style={{ fontSize: 13, color: '#c8d0e0', lineHeight: 1.6 }}>
            {latestAnalysis.reasoning || 'Technical indicators aligned'}
          </div>
        </div>
      </div>

      {/* Analysis History */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>RECENT ANALYSES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {analysisHistory.slice(1).map((analysis, idx) => (
            <div 
              key={idx} 
              style={{
                background: '#0d0d1e',
                border: '1px solid #1a1a2e',
                borderRadius: 6,
                padding: 12,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => setLatestAnalysis(analysis)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#00ff9f';
                e.currentTarget.style.background = '#0f0f1f';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#1a1a2e';
                e.currentTarget.style.background = '#0d0d1e';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{analysis.pair}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: getSignalColor(analysis.action) }}>
                  {analysis.action}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
                <span>Confidence: {analysis.confidence}%</span>
                <span>{new Date(analysis.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
