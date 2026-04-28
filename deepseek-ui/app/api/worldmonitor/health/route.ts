import { NextRequest, NextResponse } from 'next/server';
import { TIMEOUTS } from '@/lib/timeouts';
import { withCorrelation } from '@/lib/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORLDMONITOR_URL = process.env.WORLDMONITOR_URL || 'http://localhost:3000';
const WORLDMONITOR_KEY = process.env.WORLDMONITOR_KEY || 'trading-bot-internal';

interface HealthStatus {
  connected: boolean;
  url: string;
  services: {
    news: boolean;
    indices: boolean;
    commodities: boolean;
    geopolitics: boolean;
  };
  lastCheck: string;
  latency?: number;
  error?: string;
}

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
  const startTime = Date.now();
  
  const status: HealthStatus = {
    connected: false,
    url: WORLDMONITOR_URL,
    services: {
      news: false,
      indices: false,
      commodities: false,
      geopolitics: false,
    },
    lastCheck: new Date().toISOString(),
  };

  try {
    // Check if World Monitor is reachable
    const wmCheck = await fetch(WORLDMONITOR_URL, {
      headers: { 'X-WorldMonitor-Key': WORLDMONITOR_KEY },
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    
    if (wmCheck.ok) {
      status.connected = true;
    }
  } catch {
    status.error = 'World Monitor not reachable';
  }

  // Check news by hitting an RSS feed directly (avoids unreliable self-call)
  try {
    const rssRes = await fetch('https://feeds.content.dowjones.io/public/rss/mw_topstories', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    status.services.news = rssRes.ok;
  } catch {
    status.services.news = false;
  }

  // Check indices (Yahoo Finance)
  try {
    const indicesRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    if (indicesRes.ok) {
      const data = await indicesRes.json();
      status.services.indices = !!data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    }
  } catch {
    status.services.indices = false;
  }

  // Check commodities (Yahoo Finance)
  try {
    const commoditiesRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    if (commoditiesRes.ok) {
      const data = await commoditiesRes.json();
      status.services.commodities = !!data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    }
  } catch {
    status.services.commodities = false;
  }

  // Geopolitics is calculated from news, so it's available if news works
  status.services.geopolitics = status.services.news;

  // Calculate latency
  status.latency = Date.now() - startTime;

  // Overall connected status
  const servicesWorking = Object.values(status.services).filter(Boolean).length;
  status.connected = servicesWorking >= 2; // At least 2 services working

  return NextResponse.json({
    success: true,
    health: status,
    summary: {
      status: status.connected ? 'connected' : 'disconnected',
      servicesActive: servicesWorking,
      servicesTotal: 4,
    },
  });
  });
}
