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

  // Fetch bot activities and parse for analysis data
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch('/api/trading/engine');
        const data = await res.json();
        
        if (data.success && data.activities) {
          setActivities(data.activities);
          
          // Parse activities to extract analysis data
          const analyses: AnalysisData[] = [];
          let currentAnalysis: Partial<AnalysisData> = {};
          
          data.activities.forEach((activity: Activity) => {
            const msg = activity.message;
            
            // Extract pair being analyzed (support both USD and CAD pairs)
            if (msg.includes('Analyzing') || msg.includes('XXBTZCAD') || msg.includes('USD')) {
              const pairMatch = msg.match(/(XX[A-Z]+CAD|XX[A-Z]+USD|X[A-Z]+USD)/);
              if (pairMatch) {
                currentAnalysis = { pair: pairMatch[1], timestamp: activity.timestamp };
              }
            }
            
            // Extract technical indicators
            if (msg.includes('RSI') && msg.includes('MACD')) {
              const rsiMatch = msg.match(/RSI\s+([\d.]+)/);
              const macdMatch = msg.match(/MACD\s+(\w+)/);
              const confMatch = msg.match(/Confidence\s+(\d+)%/);
              
              if (rsiMatch) currentAnalysis.rsi = parseFloat(rsiMatch[1]);
              if (macdMatch) currentAnalysis.macd = macdMatch[1];
              if (confMatch) currentAnalysis.confidence = parseInt(confMatch[1]);
            }
            
            // Extract signal and reasoning
            if (msg.includes('BUY') || msg.includes('SELL') || msg.includes('HOLD')) {
              const actionMatch = msg.match(/(BUY|SELL|HOLD)/);
              if (actionMatch) {
                currentAnalysis.action = actionMatch[1];
                
                // Extract reasoning from message
                const parts = msg.split('|');
                if (parts.length > 2) {
                  currentAnalysis.reasoning = parts[parts.length - 1].trim();
                } else {
                  currentAnalysis.reasoning = msg;
                }
                
                // Complete analysis if we have pair and action
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>
          AI Trading Analysis
        </h2>
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
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>
        AI Trading Analysis
      </h2>

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
            <div key={idx} style={{
              background: '#0d0d1e',
              border: '1px solid #1a1a2e',
              borderRadius: 6,
              padding: 12,
            }}>
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
