'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
}

interface TimeframeData {
  interval: number;
  label: string;
  rsi?: number;
  rsiSignal?: string;
  macdTrend?: string;
  overallSignal?: string;
  confidence?: number;
  stochRSI?: { k: number; d: number; signal: string };
  atrPercent?: number;
  obvTrend?: string;
  ichimokuSignal?: string;
  volatilityLevel?: string;
  error?: string;
}

interface IntelligenceData {
  sentiment?: {
    fearGreed: FearGreedData;
    redditSentiment: number;
    overallSentiment: string;
    overallScore: number;
    coinDeskHeadlines: string[];
    redditPosts: Array<{ title: string; score: number; sentiment: string }>;
  };
  timeframes?: TimeframeData[];
  consensus?: {
    signal: string;
    buyCount: number;
    sellCount: number;
    holdCount: number;
    avgConfidence: number;
    totalTimeframes: number;
  };
}

interface Props {
  pair?: string;
}

export function MarketIntelligencePanel({ pair = 'AAPL' }: Props) {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'sentiment' | 'timeframes' | 'news'>('sentiment');

  const fetchIntelligence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market-intelligence?pair=${pair}&timeframes=5,15,60,240`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch market intelligence:', err);
    } finally {
      setLoading(false);
    }
  }, [pair]);

  useEffect(() => {
    fetchIntelligence();
    const interval = setInterval(fetchIntelligence, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, [fetchIntelligence]);

  const getFearGreedColor = (value: number) => {
    if (value <= 25) return '#ef4444'; // Extreme Fear - red
    if (value <= 45) return '#f97316'; // Fear - orange
    if (value <= 55) return '#eab308'; // Neutral - yellow
    if (value <= 75) return '#22c55e'; // Greed - green
    return '#10b981'; // Extreme Greed - emerald
  };

  const getSignalColor = (signal: string) => {
    if (!signal) return '#6b7280';
    const s = signal.toLowerCase();
    if (s.includes('buy') || s === 'bullish') return '#22c55e';
    if (s.includes('sell') || s === 'bearish') return '#ef4444';
    return '#eab308';
  };

  const getSignalBg = (signal: string) => {
    if (!signal) return 'rgba(107,114,128,0.15)';
    const s = signal.toLowerCase();
    if (s.includes('buy') || s === 'bullish') return 'rgba(34,197,94,0.15)';
    if (s.includes('sell') || s === 'bearish') return 'rgba(239,68,68,0.15)';
    return 'rgba(234,179,8,0.15)';
  };

  const getSentimentEmoji = (sentiment: string) => {
    if (sentiment === 'Bullish') return '🐂';
    if (sentiment === 'Bearish') return '🐻';
    return '😐';
  };

  const fearGreedGauge = (value: number) => {
    const angle = (value / 100) * 180 - 90; // -90 to 90 degrees
    return angle;
  };

  return (
    <Card style={{ background: '#0a0a16', border: '1px solid #1a1a2e', borderRadius: '12px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1a0a2e 0%, #0a1628 100%)', padding: '16px 20px', borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h3 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '16px', margin: 0 }}>
                🧠 Market Intelligence
              </h3>
              <span style={{
                background: 'linear-gradient(135deg, #00ff9f22, #0066ff22)',
                border: '1px solid #00ff9f55',
                color: '#00ff9f',
                padding: '3px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}>
                {pair}
              </span>
            </div>
            <p style={{ color: '#64748b', fontSize: '12px', margin: '2px 0 0' }}>
              Fear & Greed • Reddit Sentiment • Multi-Timeframe Analysis
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastUpdate && (
              <span style={{ color: '#475569', fontSize: '11px' }}>
                {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchIntelligence}
              disabled={loading}
              style={{
                background: loading ? '#1a1a2e' : '#1e3a5f',
                border: '1px solid #2a4a7f',
                borderRadius: '6px',
                color: '#60a5fa',
                padding: '4px 10px',
                fontSize: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '⟳ Loading...' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '12px' }}>
          {(['sentiment', 'timeframes', 'news'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === tab ? '#1e3a5f' : 'transparent',
                color: activeTab === tab ? '#60a5fa' : '#64748b',
                textTransform: 'capitalize',
              }}
            >
              {tab === 'sentiment' ? '😱 Sentiment' : tab === 'timeframes' ? '📊 Multi-TF' : '📰 News'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        {!data && !loading && (
          <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0' }}>
            Click Refresh to load market intelligence
          </div>
        )}

        {loading && !data && (
          <div style={{ textAlign: 'center', color: '#60a5fa', padding: '40px 0' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⟳</div>
            Fetching market intelligence...
          </div>
        )}

        {data && activeTab === 'sentiment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Consensus Signal */}
            {data.consensus && (
              <div style={{
                background: getSignalBg(data.consensus.signal),
                border: `1px solid ${getSignalColor(data.consensus.signal)}33`,
                borderRadius: '10px',
                padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '11px' }}>MULTI-TF CONSENSUS FOR <span style={{ color: '#00ff9f', fontWeight: 700 }}>{pair}</span></div>
                  <div style={{ color: '#94a3b8', fontSize: '11px' }}>AVG CONFIDENCE</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: getSignalColor(data.consensus.signal), fontSize: '26px', fontWeight: 800 }}>
                      {data.consensus.signal}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                      {data.consensus.buyCount}↑ {data.consensus.sellCount}↓ {data.consensus.holdCount}→ across {data.consensus.totalTimeframes} TFs
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#e2e8f0', fontSize: '32px', fontWeight: 700 }}>
                      {data.consensus.avgConfidence}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fear & Greed */}
            {data.sentiment?.fearGreed && (
              <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '14px', border: '1px solid #1a1a2e' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '10px', fontWeight: 600 }}>
                  😱 FEAR & GREED INDEX
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  {/* Gauge */}
                  <div style={{ position: 'relative', width: '80px', height: '50px', flexShrink: 0 }}>
                    <svg viewBox="0 0 100 60" style={{ width: '100%', height: '100%' }}>
                      {/* Background arc */}
                      <path d="M 10 55 A 40 40 0 0 1 90 55" fill="none" stroke="#1a1a2e" strokeWidth="8" strokeLinecap="round" />
                      {/* Colored arc */}
                      <path
                        d="M 10 55 A 40 40 0 0 1 90 55"
                        fill="none"
                        stroke={getFearGreedColor(data.sentiment.fearGreed.value)}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${(data.sentiment.fearGreed.value / 100) * 125.6} 125.6`}
                      />
                      {/* Needle */}
                      <line
                        x1="50" y1="55"
                        x2={50 + 30 * Math.cos((fearGreedGauge(data.sentiment.fearGreed.value) * Math.PI) / 180)}
                        y2={55 + 30 * Math.sin((fearGreedGauge(data.sentiment.fearGreed.value) * Math.PI) / 180)}
                        stroke="#e2e8f0"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <circle cx="50" cy="55" r="3" fill="#e2e8f0" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ color: getFearGreedColor(data.sentiment.fearGreed.value), fontSize: '28px', fontWeight: 800, lineHeight: 1 }}>
                      {data.sentiment.fearGreed.value}
                    </div>
                    <div style={{ color: getFearGreedColor(data.sentiment.fearGreed.value), fontSize: '13px', fontWeight: 600 }}>
                      {data.sentiment.fearGreed.classification}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Reddit + Overall Sentiment */}
            {data.sentiment && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px', border: '1px solid #1a1a2e' }}>
                  <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '6px' }}>🤖 REDDIT SENTIMENT</div>
                  <div style={{ color: data.sentiment.redditSentiment > 10 ? '#22c55e' : data.sentiment.redditSentiment < -10 ? '#ef4444' : '#eab308', fontSize: '20px', fontWeight: 700 }}>
                    {data.sentiment.redditSentiment > 0 ? '+' : ''}{data.sentiment.redditSentiment.toFixed(0)}
                  </div>
                  <div style={{ color: '#475569', fontSize: '11px' }}>Score (-100 to +100)</div>
                </div>
                <div style={{
                  background: getSignalBg(data.sentiment.overallSentiment),
                  borderRadius: '10px',
                  padding: '12px',
                  border: `1px solid ${getSignalColor(data.sentiment.overallSentiment)}33`,
                }}>
                  <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '6px' }}>🌐 OVERALL</div>
                  <div style={{ color: getSignalColor(data.sentiment.overallSentiment), fontSize: '18px', fontWeight: 700 }}>
                    {getSentimentEmoji(data.sentiment.overallSentiment)} {data.sentiment.overallSentiment}
                  </div>
                  <div style={{ color: '#475569', fontSize: '11px' }}>Score: {data.sentiment.overallScore.toFixed(0)}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {data && activeTab === 'timeframes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.timeframes?.map(tf => (
              <div
                key={tf.interval}
                style={{
                  background: '#0d0d1a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  border: `1px solid ${tf.error ? '#374151' : getSignalColor(tf.overallSignal || '')}22`,
                }}
              >
                {tf.error ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '14px' }}>{tf.label || `${tf.interval}m`}</span>
                    <span style={{ color: '#475569', fontSize: '12px' }}>No data</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '14px' }}>{tf.label}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{
                          background: getSignalBg(tf.overallSignal || ''),
                          color: getSignalColor(tf.overallSignal || ''),
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}>
                          {(tf.overallSignal || 'HOLD').replace('_', ' ').toUpperCase()}
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>{tf.confidence}%</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>RSI</div>
                        <div style={{ color: tf.rsi && tf.rsi < 30 ? '#22c55e' : tf.rsi && tf.rsi > 70 ? '#ef4444' : '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>
                          {tf.rsi?.toFixed(1)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>MACD</div>
                        <div style={{ color: getSignalColor(tf.macdTrend || ''), fontSize: '13px', fontWeight: 600 }}>
                          {tf.macdTrend?.toUpperCase().slice(0, 4)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>STOCH</div>
                        <div style={{ color: tf.stochRSI?.signal === 'oversold' ? '#22c55e' : tf.stochRSI?.signal === 'overbought' ? '#ef4444' : '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>
                          {tf.stochRSI?.k.toFixed(0)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>ICHI</div>
                        <div style={{ color: getSignalColor(tf.ichimokuSignal || ''), fontSize: '13px', fontWeight: 600 }}>
                          {tf.ichimokuSignal?.toUpperCase().slice(0, 4)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>ATR%</div>
                        <div style={{ color: tf.atrPercent && tf.atrPercent > 3 ? '#f97316' : '#94a3b8', fontSize: '12px' }}>
                          {tf.atrPercent?.toFixed(2)}%
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>OBV</div>
                        <div style={{ color: tf.obvTrend === 'rising' ? '#22c55e' : tf.obvTrend === 'falling' ? '#ef4444' : '#94a3b8', fontSize: '12px' }}>
                          {tf.obvTrend?.toUpperCase()}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#475569', fontSize: '10px' }}>VOL</div>
                        <div style={{ color: tf.volatilityLevel === 'high' ? '#f97316' : tf.volatilityLevel === 'low' ? '#22c55e' : '#94a3b8', fontSize: '12px' }}>
                          {tf.volatilityLevel?.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {data && activeTab === 'news' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* CoinDesk Headlines */}
            {data.sentiment?.coinDeskHeadlines && data.sentiment.coinDeskHeadlines.length > 0 && (
              <div>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600, marginBottom: '8px' }}>
                  📰 COINDESK HEADLINES
                </div>
                {data.sentiment.coinDeskHeadlines.map((headline, i) => (
                  <div key={i} style={{
                    background: '#0d0d1a',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    marginBottom: '6px',
                    border: '1px solid #1a1a2e',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    lineHeight: 1.4,
                  }}>
                    {headline}
                  </div>
                ))}
              </div>
            )}

            {/* Reddit Posts */}
            {data.sentiment?.redditPosts && data.sentiment.redditPosts.length > 0 && (
              <div>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600, marginBottom: '8px', marginTop: '8px' }}>
                  🤖 TOP REDDIT POSTS
                </div>
                {data.sentiment.redditPosts.map((post, i) => (
                  <div key={i} style={{
                    background: '#0d0d1a',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    marginBottom: '6px',
                    border: `1px solid ${getSignalColor(post.sentiment)}22`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}>
                    <div style={{ color: '#cbd5e1', fontSize: '12px', lineHeight: 1.4, flex: 1 }}>
                      {post.title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                      <span style={{
                        color: getSignalColor(post.sentiment),
                        fontSize: '10px',
                        fontWeight: 700,
                        background: getSignalBg(post.sentiment),
                        padding: '1px 5px',
                        borderRadius: '3px',
                      }}>
                        {post.sentiment.toUpperCase()}
                      </span>
                      <span style={{ color: '#475569', fontSize: '10px' }}>↑{post.score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(!data.sentiment?.coinDeskHeadlines?.length && !data.sentiment?.redditPosts?.length) && (
              <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0' }}>
                No news data available. Click Refresh to try again.
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
