"use client";

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { readJsonSafely } from '@/lib/safe-json';

interface PortfolioChartProps {
  height?: number;
}

export default function PortfolioChart({ height = 300 }: PortfolioChartProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetchPortfolioHistory();
    
    // Refresh every 5 minutes
    const refreshInterval = setInterval(() => {
      fetchPortfolioHistory();
    }, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, []);

  const fetchPortfolioHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/portfolio/history?stats=true');
      const data = await readJsonSafely<any>(res, 'portfolio history');

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch portfolio history');
      }

      // Format data for Recharts
      const formattedData = data.history.map((snapshot: any) => ({
        time: new Date(snapshot.timestamp).toLocaleTimeString('en-US', { 
          month: 'short',
          day: 'numeric',
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        }),
        timestamp: snapshot.timestamp,
        value: snapshot.totalValue,
        pnl: snapshot.pnl,
        pnlPercent: snapshot.pnlPercent,
      }));

      setChartData(formattedData);
      setStats(data.stats);
      setLoading(false);
    } catch (err: any) {
      console.error('Portfolio history error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const pnl = data.pnl ?? 0;
      const pnlPercent = data.pnlPercent ?? 0;
      return (
        <div style={{
          background: '#0a0a14',
          border: '1px solid #1a1a2e',
          borderRadius: 8,
          padding: 12,
          color: '#c8d0e0',
          fontSize: 12,
        }}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>{data.time}</div>
          <div style={{ color: '#00ff9f' }}>Value: ${(data.value ?? 0).toFixed(2)}</div>
          {pnl !== 0 && (
            <>
              <div style={{ color: pnl >= 0 ? '#00ff9f' : '#ff4d6d', marginTop: 4 }}>
                P&L: ${pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)
              </div>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  if (loading && chartData.length === 0) {
    return (
      <div style={{ 
        width: '100%', 
        height: `${height}px`, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#666',
        fontSize: 14,
      }}>
        Loading portfolio history...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        width: '100%',
        height: `${height}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ff4d6d',
        fontSize: 14,
      }}>
        Error: {error}
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div style={{
        width: '100%',
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        fontSize: 14,
      }}>
        <div style={{ marginBottom: 12 }}>No portfolio history yet</div>
        <div style={{ fontSize: 12, color: '#444' }}>
          Portfolio snapshots will appear here as the bot trades
        </div>
      </div>
    );
  }

  const latestValue = chartData[chartData.length - 1]?.value || 0;
  const initialValue = chartData[0]?.value || 0;
  const totalChange = latestValue - initialValue;
  const totalChangePercent = initialValue > 0 ? (totalChange / initialValue) * 100 : 0;
  const isPositive = totalChange >= 0;

  return (
    <div style={{ width: '100%' }}>
      {/* Stats Summary */}
      {stats && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
          gap: 12, 
          marginBottom: 16 
        }}>
          <div style={{
            background: '#0d0d1e',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #1a1a2e',
          }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Current Value</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
              ${stats.currentValue.toFixed(2)}
            </div>
          </div>
          
          <div style={{
            background: '#0d0d1e',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #1a1a2e',
          }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Total P&L</div>
            <div style={{ 
              fontSize: 18, 
              fontWeight: 700, 
              color: isPositive ? '#00ff9f' : '#ff4d6d' 
            }}>
              {isPositive ? '+' : ''}${totalChange.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: isPositive ? '#00ff9f' : '#ff4d6d' }}>
              {isPositive ? '+' : ''}{totalChangePercent.toFixed(2)}%
            </div>
          </div>
          
          <div style={{
            background: '#0d0d1e',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #1a1a2e',
          }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>High / Low</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#00ff9f' }}>
              ${stats.highestValue.toFixed(2)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ff4d6d' }}>
              ${stats.lowestValue.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? "#00ff9f" : "#ff4d6d"} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={isPositive ? "#00ff9f" : "#ff4d6d"} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
          <XAxis 
            dataKey="time" 
            stroke="#666" 
            style={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis 
            stroke="#666" 
            style={{ fontSize: 11 }}
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke={isPositive ? "#00ff9f" : "#ff4d6d"}
            strokeWidth={2}
            fill="url(#colorValue)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
