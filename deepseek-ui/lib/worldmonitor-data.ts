/**
 * World Monitor Data Integration
 * Extracts market-relevant data from World Monitor for trading analysis
 */

const WORLDMONITOR_URL = process.env.WORLDMONITOR_URL || 'http://localhost:3000';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CommodityQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
}

export interface GlobalIndex {
  symbol: string;
  name: string;
  region: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface ConflictEvent {
  id: string;
  country: string;
  region: string;
  type: string;
  fatalities: number;
  date: string;
  description: string;
}

export interface GeopoliticalRisk {
  level: 'low' | 'medium' | 'high' | 'extreme';
  score: number; // 0-100
  hotspots: string[];
  marketImpact: string;
  affectedSectors: string[];
}

export interface EnergyData {
  oilPrice: number;
  oilChange: number;
  gasPrice: number;
  gasChange: number;
  inventoryChange?: number;
  opecNews?: string[];
}

export interface WorldMonitorSummary {
  timestamp: string;
  commodities: CommodityQuote[];
  globalIndices: GlobalIndex[];
  geopoliticalRisk: GeopoliticalRisk;
  energy: EnergyData;
  breakingNews: string[];
  marketMovers: string[];
}

// ─── Data Fetchers ──────────────────────────────────────────────────────────

/**
 * Fetch commodity prices (Oil, Gold, Silver, Natural Gas)
 */
export async function fetchCommodityPrices(): Promise<CommodityQuote[]> {
  try {
    // Try Yahoo Finance for commodities
    const symbols = ['CL=F', 'GC=F', 'SI=F', 'NG=F']; // Oil, Gold, Silver, NatGas
    const names = ['Crude Oil (WTI)', 'Gold', 'Silver', 'Natural Gas'];
    
    const quotes: CommodityQuote[] = [];
    
    for (let i = 0; i < symbols.length; i++) {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbols[i]}?interval=1d&range=2d`,
          { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000),
          }
        );
        
        if (res.ok) {
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || price;
            quotes.push({
              symbol: symbols[i],
              name: names[i],
              price,
              change: price - prevClose,
              changePercent: ((price - prevClose) / prevClose) * 100,
              currency: 'USD',
            });
          }
        }
      } catch {
        // Skip failed symbols
      }
    }
    
    return quotes;
  } catch (error) {
    console.error('Failed to fetch commodity prices:', error);
    return [];
  }
}

/**
 * Fetch global market indices
 */
export async function fetchGlobalIndices(): Promise<GlobalIndex[]> {
  try {
    const indices = [
      { symbol: '^GSPC', name: 'S&P 500', region: 'US' },
      { symbol: '^DJI', name: 'Dow Jones', region: 'US' },
      { symbol: '^IXIC', name: 'NASDAQ', region: 'US' },
      { symbol: '^FTSE', name: 'FTSE 100', region: 'UK' },
      { symbol: '^GDAXI', name: 'DAX', region: 'Germany' },
      { symbol: '^N225', name: 'Nikkei 225', region: 'Japan' },
      { symbol: '^HSI', name: 'Hang Seng', region: 'Hong Kong' },
    ];
    
    const results: GlobalIndex[] = [];
    
    for (const idx of indices) {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${idx.symbol}?interval=1d&range=2d`,
          { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000),
          }
        );
        
        if (res.ok) {
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || price;
            results.push({
              ...idx,
              price,
              change: price - prevClose,
              changePercent: ((price - prevClose) / prevClose) * 100,
            });
          }
        }
      } catch {
        // Skip failed indices
      }
    }
    
    return results;
  } catch (error) {
    console.error('Failed to fetch global indices:', error);
    return [];
  }
}

/**
 * Fetch breaking financial news
 */
export async function fetchBreakingNews(limit = 10): Promise<string[]> {
  try {
    const res = await fetch(`http://localhost:3001/api/worldmonitor/news?category=markets&limit=${limit}`, {
      signal: AbortSignal.timeout(10000),
    });
    
    if (res.ok) {
      const data = await res.json();
      return (data.news || []).map((n: any) => `[${n.source}] ${n.title}`);
    }
    
    return [];
  } catch {
    return [];
  }
}

/**
 * Calculate geopolitical risk score based on conflict data
 */
export async function calculateGeopoliticalRisk(): Promise<GeopoliticalRisk> {
  try {
    // Fetch recent news and look for geopolitical keywords
    const news = await fetchBreakingNews(30);
    
    const riskKeywords = {
      extreme: ['war', 'invasion', 'nuclear', 'missile strike', 'declaration of war'],
      high: ['sanctions', 'military buildup', 'conflict escalation', 'embargo', 'coup'],
      medium: ['tensions', 'diplomatic crisis', 'protests', 'civil unrest', 'trade dispute'],
    };
    
    let score = 20; // Base score
    const hotspots: string[] = [];
    const affectedSectors: string[] = [];
    
    const newsText = news.join(' ').toLowerCase();
    
    // Check for risk keywords
    for (const keyword of riskKeywords.extreme) {
      if (newsText.includes(keyword)) {
        score += 25;
        hotspots.push(keyword);
      }
    }
    
    for (const keyword of riskKeywords.high) {
      if (newsText.includes(keyword)) {
        score += 15;
        hotspots.push(keyword);
      }
    }
    
    for (const keyword of riskKeywords.medium) {
      if (newsText.includes(keyword)) {
        score += 8;
      }
    }
    
    // Check for region-specific risks
    const regions = ['middle east', 'ukraine', 'russia', 'china', 'taiwan', 'iran', 'israel', 'gaza'];
    for (const region of regions) {
      if (newsText.includes(region)) {
        hotspots.push(region);
        if (['oil', 'energy', 'crude'].some(k => newsText.includes(k))) {
          affectedSectors.push('Energy');
        }
        if (['chip', 'semiconductor', 'tech'].some(k => newsText.includes(k))) {
          affectedSectors.push('Technology');
        }
      }
    }
    
    score = Math.min(100, score);
    
    const level = score >= 75 ? 'extreme' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';
    
    const impacts: Record<string, string> = {
      extreme: 'Severe market volatility expected. Consider reducing exposure.',
      high: 'Elevated risk. Monitor positions closely, consider hedging.',
      medium: 'Moderate uncertainty. Stay informed on developments.',
      low: 'Stable geopolitical environment for markets.',
    };
    
    return {
      level,
      score,
      hotspots: [...new Set(hotspots)].slice(0, 5),
      marketImpact: impacts[level],
      affectedSectors: [...new Set(affectedSectors)],
    };
  } catch (error) {
    console.error('Failed to calculate geopolitical risk:', error);
    return {
      level: 'low',
      score: 20,
      hotspots: [],
      marketImpact: 'Unable to assess geopolitical risk',
      affectedSectors: [],
    };
  }
}

/**
 * Get energy market data
 */
export async function fetchEnergyData(): Promise<EnergyData> {
  try {
    const commodities = await fetchCommodityPrices();
    const oil = commodities.find(c => c.symbol === 'CL=F');
    const gas = commodities.find(c => c.symbol === 'NG=F');
    
    return {
      oilPrice: oil?.price || 0,
      oilChange: oil?.changePercent || 0,
      gasPrice: gas?.price || 0,
      gasChange: gas?.changePercent || 0,
    };
  } catch {
    return {
      oilPrice: 0,
      oilChange: 0,
      gasPrice: 0,
      gasChange: 0,
    };
  }
}

/**
 * Get complete World Monitor summary for trading analysis
 */
export async function getWorldMonitorSummary(): Promise<WorldMonitorSummary> {
  const [commodities, globalIndices, geopoliticalRisk, energy, breakingNews] = await Promise.all([
    fetchCommodityPrices(),
    fetchGlobalIndices(),
    calculateGeopoliticalRisk(),
    fetchEnergyData(),
    fetchBreakingNews(5),
  ]);
  
  // Extract market movers from news
  const marketMovers = breakingNews
    .filter(n => 
      n.toLowerCase().includes('surge') ||
      n.toLowerCase().includes('plunge') ||
      n.toLowerCase().includes('rally') ||
      n.toLowerCase().includes('crash') ||
      n.toLowerCase().includes('record')
    )
    .slice(0, 3);
  
  return {
    timestamp: new Date().toISOString(),
    commodities,
    globalIndices,
    geopoliticalRisk,
    energy,
    breakingNews,
    marketMovers,
  };
}

/**
 * Get market context string for AI analysis
 */
export async function getMarketContextForAI(): Promise<string> {
  const summary = await getWorldMonitorSummary();
  
  let context = `GLOBAL MARKET CONTEXT (${new Date().toUTCString()}):\n\n`;
  
  // Global Indices
  if (summary.globalIndices.length > 0) {
    context += `GLOBAL INDICES:\n`;
    for (const idx of summary.globalIndices) {
      const arrow = idx.changePercent >= 0 ? '▲' : '▼';
      context += `  ${idx.name} (${idx.region}): ${idx.price.toLocaleString()} ${arrow} ${Math.abs(idx.changePercent).toFixed(2)}%\n`;
    }
    context += '\n';
  }
  
  // Commodities
  if (summary.commodities.length > 0) {
    context += `COMMODITIES:\n`;
    for (const c of summary.commodities) {
      const arrow = c.changePercent >= 0 ? '▲' : '▼';
      context += `  ${c.name}: $${c.price.toFixed(2)} ${arrow} ${Math.abs(c.changePercent).toFixed(2)}%\n`;
    }
    context += '\n';
  }
  
  // Geopolitical Risk
  context += `GEOPOLITICAL RISK: ${summary.geopoliticalRisk.level.toUpperCase()} (Score: ${summary.geopoliticalRisk.score}/100)\n`;
  if (summary.geopoliticalRisk.hotspots.length > 0) {
    context += `  Hotspots: ${summary.geopoliticalRisk.hotspots.join(', ')}\n`;
  }
  context += `  Impact: ${summary.geopoliticalRisk.marketImpact}\n\n`;
  
  // Breaking News
  if (summary.breakingNews.length > 0) {
    context += `BREAKING NEWS:\n`;
    for (const news of summary.breakingNews.slice(0, 5)) {
      context += `  • ${news}\n`;
    }
  }
  
  return context;
}
