"use client";

import { useEffect, useRef, useState } from 'react';

interface TradingChartProps {
  pair: string;
  interval?: number;
  height?: number;
}

export default function TradingChart({ pair, interval = 60, height = 400 }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanupFn: (() => void) | undefined;

    const initChart = async () => {
      // Wait for the DOM element to be available and have dimensions
      if (!containerRef.current) return;

      // If the container has no width yet, wait a few frames for layout to settle
      let attempts = 0;
      while (containerRef.current && containerRef.current.clientWidth === 0 && attempts < 10) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        attempts++;
      }

      // Double-check after the frame
      if (!containerRef.current || containerRef.current.clientWidth === 0) return;

      // Capture a stable reference to the DOM node
      const container = containerRef.current;

      try {
        // Dynamically import lightweight-charts v5 - uses new addSeries API
        const lc = await import('lightweight-charts');
        const { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries } = lc as any;

        // Destroy existing chart if any
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        // Create chart
        const chart = createChart(container, {
          width: container.clientWidth || 600,
          height: height,
          layout: {
            background: { type: ColorType.Solid, color: '#080810' },
            textColor: '#888',
          },
          grid: {
            vertLines: { color: '#1a1a2e' },
            horzLines: { color: '#1a1a2e' },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
              color: '#ffffff40',
              width: 1,
              style: 3,
              labelBackgroundColor: '#1a1a2e',
            },
            horzLine: {
              color: '#ffffff40',
              width: 1,
              style: 3,
              labelBackgroundColor: '#1a1a2e',
            },
          },
          rightPriceScale: {
            borderColor: '#1a1a2e',
          },
          timeScale: {
            borderColor: '#1a1a2e',
            timeVisible: true,
            secondsVisible: false,
          },
        });

        chartRef.current = chart;

        // v5 API: chart.addSeries(CandlestickSeries, options)
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#00ff9f',
          downColor: '#ff4d6d',
          borderUpColor: '#00ff9f',
          borderDownColor: '#ff4d6d',
          wickUpColor: '#00ff9f',
          wickDownColor: '#ff4d6d',
        });
        seriesRef.current = candleSeries;

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
          color: '#26a69a',
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        // Handle resize
        const resizeObserver = new ResizeObserver(() => {
          if (containerRef.current && chart) {
            chart.applyOptions({ width: containerRef.current.clientWidth });
          }
        });
        resizeObserver.observe(container);

        // Load data
        await loadChartData(candleSeries, volumeSeries, pair, interval);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (err: any) {
        console.error('Chart init error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    initChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [pair, interval, height]);

  const intervalToIB = (mins: number): { barSize: string; duration: string } => {
    if (mins <= 1)    return { barSize: '1 min',   duration: '1 D' };
    if (mins <= 5)    return { barSize: '5 mins',  duration: '3 D' };
    if (mins <= 15)   return { barSize: '15 mins', duration: '5 D' };
    if (mins <= 60)   return { barSize: '1 hour',  duration: '10 D' };
    if (mins <= 240)  return { barSize: '4 hours', duration: '20 D' };
    return              { barSize: '1 day',   duration: '3 M' };
  };

  const loadChartData = async (candleSeries: any, volumeSeries: any, currentPair: string = pair, currentInterval: number = interval) => {
    try {
      setLoading(true);
      setError(null);

      const { barSize, duration } = intervalToIB(currentInterval);
      const params = new URLSearchParams({ symbol: currentPair, barSize, duration });
      const res = await fetch(`/api/ib/ohlc?${params}`);
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Failed to fetch chart data');

      const candleData = data.bars.map((c: any) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000) as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData = data.bars.map((c: any) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000) as any,
        value: c.volume,
        color: c.close >= c.open ? '#00ff9f40' : '#ff4d6d40',
      }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);

      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }

      setLoading(false);
    } catch (err: any) {
      console.error('Chart data error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  // Refresh data periodically
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      if (seriesRef.current && volumeSeriesRef.current) {
        await loadChartData(seriesRef.current, volumeSeriesRef.current, pair, interval);
      }
    }, 30000);
    return () => clearInterval(refreshInterval);
  }, [pair, interval]);

  return (
    <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0a0a1480', zIndex: 10, color: '#c8d0e0',
          pointerEvents: 'none',
        }}>
          Loading chart...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', top: 10, left: 10, right: 10, padding: 12,
          background: '#ff4d6d20', border: '1px solid #ff4d6d',
          borderRadius: 8, color: '#ff4d6d', fontSize: 12, zIndex: 10,
        }}>
          Error: {error}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
