/**
 * Market Intelligence Module
 * Fetches CNN Fear & Greed Index (stocks), Reddit sentiment (r/stocks, r/investing, r/wallstreetbets),
 * Yahoo Finance / Reuters news headlines, and provides multi-timeframe analysis support
 */

import { TIMEOUTS } from '@/lib/timeouts';
import { createLogger } from '@/lib/logger';
import { fearGreedCache, vixCache, spyTrendCache } from '@/lib/cache';
import {
  VIX_LOW_THRESHOLD, VIX_ELEVATED_THRESHOLD, VIX_HIGH_THRESHOLD,
  VIX_ELEVATED_SIZE_MULT, VIX_HIGH_SIZE_MULT, VIX_EXTREME_SIZE_MULT,
  MAX_POSITION_FRACTION, SL_ATR_MULTIPLIER, TP_ATR_MULTIPLIER,
  IB_MIN_FEE_CAD, IB_FEE_PER_SHARE_CAD, IB_MAX_FEE_FRACTION, MIN_PROFIT_FEE_MULTIPLIER,
  EARNINGS_AVOID_DAYS, EARNINGS_CAUTION_DAYS, EARNINGS_CAUTION_SIZE_MULT,
  BULLISH_SCORE_THRESHOLD, BEARISH_SCORE_THRESHOLD,
} from '@/lib/constants';

const log = createLogger('market-intelligence');

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
  source: 'cnn' | 'fallback';
}

export interface RedditPost {
  title: string;
  score: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface NewsHeadline {
  title: string;
  source: string;
}

export interface VixData {
  value: number;               // current VIX level
  level: 'low' | 'elevated' | 'high' | 'extreme'; // trading risk tier
  tradingAllowed: boolean;     // false when VIX >= 35 (too dangerous)
  positionSizeMultiplier: number; // 1.0 normal, 0.5 cautious, 0.0 blocked
  interpretation: string;      // human-readable explanation
  timestamp: string;
}

export interface SpyTrend {
  price: number;               // current SPY price
  change1d: number;            // 1-day % change
  change5d: number;            // 5-day % change
  above200ma: boolean;         // is SPY above its 200-day moving average?
  trend: 'uptrend' | 'downtrend' | 'sideways';
  bias: 'buy' | 'sell' | 'neutral'; // overall market bias for individual stocks
  interpretation: string;
  timestamp: string;
}

export interface EarningsData {
  hasUpcomingEarnings: boolean;  // earnings within next 7 days
  daysUntilEarnings: number | null;
  earningsDate: string | null;   // ISO date string
  earningsTime: 'pre' | 'post' | 'unknown' | null; // before or after market
  tradingAllowed: boolean;       // false if earnings within 2 days
  riskLevel: 'safe' | 'caution' | 'avoid'; // safe >7d, caution 3-7d, avoid <3d
  interpretation: string;
}

export interface PositionSizing {
  symbol: string;
  price: number;
  atr: number;               // Average True Range (volatility in $)
  atrPercent: number;        // ATR as % of price
  baseShares: number;        // shares before adjustments
  finalShares: number;       // shares after VIX + earnings multipliers
  stopLossPrice: number;     // price - 1.5x ATR
  takeProfitPrice: number;   // price + 2x ATR (2:1 risk/reward)
  estimatedCost: number;     // finalShares * price
  estimatedFees: number;     // IBKR Canada: max($1, shares * $0.01)
  estimatedRoundTripFees: number; // buy + sell fees
  minimumProfitNeeded: number;   // fees * 2 to break even safely
  expectedProfit: number;        // takeProfitPrice move * finalShares
  worthTrading: boolean;         // expectedProfit > minimumProfitNeeded
  interpretation: string;
}

export interface SentimentSummary {
  fearGreed: FearGreedData;
  vix: VixData;
  spyTrend: SpyTrend;
  earnings: EarningsData;
  redditSentiment: number; // -100 to 100
  redditPosts: RedditPost[];
  newsHeadlines: NewsHeadline[];
  /** @deprecated use newsHeadlines */
  coinDeskHeadlines: string[];
  overallSentiment: 'Bullish' | 'Bearish' | 'Neutral';
  overallScore: number; // -100 to 100
}

export interface MultiTimeframeSignal {
  timeframe: string;
  interval: number; // minutes
  rsi: number;
  macdTrend: 'bullish' | 'bearish' | 'neutral';
  bbPosition: 'above' | 'below' | 'inside';
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
}

/**
 * Fetch upcoming earnings date for a stock from Yahoo Finance — free, no API key.
 * Earnings within 2 days = avoid trading (huge volatility risk, gap risk)
 * Earnings within 3-7 days = caution (reduce size, tighten stops)
 * Earnings > 7 days away = safe to trade normally
 */
export async function getEarningsData(symbol: string): Promise<EarningsData> {
  // Skip for ETFs, indices, and crypto — no earnings risk
  const skipSymbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'BTC', 'ETH', 'SOL', 'LTC', 'XRP'];
  if (skipSymbols.includes(symbol.toUpperCase())) {
    return {
      hasUpcomingEarnings: false, daysUntilEarnings: null, earningsDate: null,
      earningsTime: null, tradingAllowed: true, riskLevel: 'safe',
      interpretation: `${symbol} is an ETF/index — no earnings risk.`,
    };
  }

  try {
    // EarningsWhispers has reliable free earnings dates via their stock page
    const res = await fetch(
      `https://www.earningswhispers.com/stocks/${symbol.toLowerCase()}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      }
    );
    if (!res.ok) throw new Error(`EarningsWhispers HTTP ${res.status}`);

    const html = await res.text();

    // Parse date like "April 30, 2026" or "May 1, 2026"
    const dateMatch = html.match(/([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
    if (!dateMatch) throw new Error('No earnings date found');

    const earningsDate = new Date(dateMatch[1]);
    if (isNaN(earningsDate.getTime())) throw new Error('Invalid earnings date');

    const now = new Date();
    const daysUntil = Math.ceil((earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      return {
        hasUpcomingEarnings: false, daysUntilEarnings: null,
        earningsDate: earningsDate.toISOString(), earningsTime: null,
        tradingAllowed: true, riskLevel: 'safe',
        interpretation: `${symbol} reported ${Math.abs(daysUntil)} days ago. No upcoming earnings risk.`,
      };
    }

    // Detect pre/post market timing from page text
    let earningsTime: EarningsData['earningsTime'] = 'unknown';
    if (/before\s+open|pre[\s-]?market/i.test(html)) earningsTime = 'pre';
    else if (/after\s+close|post[\s-]?market|after[\s-]?hours/i.test(html)) earningsTime = 'post';

    let riskLevel: EarningsData['riskLevel'];
    let tradingAllowed: boolean;
    let interpretation: string;
    const timeLabel = earningsTime === 'pre' ? ' (before open)' : earningsTime === 'post' ? ' (after close)' : '';

    if (daysUntil <= EARNINGS_AVOID_DAYS) {
      riskLevel = 'avoid';
      tradingAllowed = false;
      interpretation = `⚠️ ${symbol} earnings in ${daysUntil} day(s) — ${earningsDate.toDateString()}${timeLabel}. Trading BLOCKED — extreme gap risk.`;
    } else if (daysUntil <= EARNINGS_CAUTION_DAYS) {
      riskLevel = 'caution';
      tradingAllowed = true;
      interpretation = `⚡ ${symbol} earnings in ${daysUntil} days — ${earningsDate.toDateString()}${timeLabel}. Reduce position size, tighten stops.`;
    } else {
      riskLevel = 'safe';
      tradingAllowed = true;
      interpretation = `✅ ${symbol} next earnings in ${daysUntil} days (${earningsDate.toDateString()}). Safe to trade normally.`;
    }

    return {
      hasUpcomingEarnings: daysUntil <= 7,
      daysUntilEarnings: daysUntil,
      earningsDate: earningsDate.toISOString(),
      earningsTime,
      tradingAllowed,
      riskLevel,
      interpretation,
    };
  } catch (err) {
    log.warn('Earnings data unavailable', { symbol, error: String(err) });
    return {
      hasUpcomingEarnings: false, daysUntilEarnings: null, earningsDate: null,
      earningsTime: null, tradingAllowed: true, riskLevel: 'safe',
      interpretation: `Earnings data unavailable for ${symbol} — assuming safe.`,
    };
  }
}

/**
 * Fetch SPY trend from Yahoo Finance.
 * Used as a market-wide filter — if S&P 500 is in a downtrend, avoid buying individual stocks.
 * Logic:
 *   - 1D change > +0.5%  AND above 200MA → uptrend → buy bias
 *   - 1D change < -0.5%  OR  below 200MA → downtrend → sell bias (avoid new longs)
 *   - otherwise → sideways → neutral
 */
export async function getSpyTrend(): Promise<SpyTrend> {
  // Cached for 5 minutes
  return spyTrendCache.getOrFetch('spy', () => _fetchSpyTrend());
}

async function _fetchSpyTrend(): Promise<SpyTrend> {
  try {
    // Fetch 1 year of daily data to compute 200MA
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      }
    );
    if (!res.ok) throw new Error(`Yahoo SPY HTTP ${res.status}`);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((v: any) => v != null);
    const meta = result?.meta ?? {};

    if (closes.length < 10) throw new Error('Insufficient SPY data');

    const price: number = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prev1d: number = closes[closes.length - 2] ?? price;
    const prev5d: number = closes[closes.length - 6] ?? prev1d;

    const change1d = ((price - prev1d) / prev1d) * 100;
    const change5d = ((price - prev5d) / prev5d) * 100;

    // 200-day moving average
    const ma200closes = closes.slice(-200);
    const ma200 = ma200closes.reduce((a, b) => a + b, 0) / ma200closes.length;
    const above200ma = price > ma200;

    let trend: SpyTrend['trend'];
    let bias: SpyTrend['bias'];
    let interpretation: string;

    if (change1d >= 0.5 && above200ma) {
      trend = 'uptrend';
      bias = 'buy';
      interpretation = `SPY $${price.toFixed(2)} +${change1d.toFixed(2)}% today, above 200MA ($${ma200.toFixed(2)}). Market uptrend — favour long positions.`;
    } else if (change1d <= -0.5 || !above200ma) {
      trend = 'downtrend';
      bias = 'sell';
      interpretation = `SPY $${price.toFixed(2)} ${change1d.toFixed(2)}% today, ${above200ma ? 'above' : 'BELOW'} 200MA ($${ma200.toFixed(2)}). Market downtrend — avoid new longs, favour cash or shorts.`;
    } else {
      trend = 'sideways';
      bias = 'neutral';
      interpretation = `SPY $${price.toFixed(2)} ${change1d >= 0 ? '+' : ''}${change1d.toFixed(2)}% today, above 200MA ($${ma200.toFixed(2)}). Sideways market — be selective, wait for clear signals.`;
    }

    return { price, change1d, change5d, above200ma, trend, bias, interpretation, timestamp: new Date().toISOString() };
  } catch (err) {
    log.warn('SPY trend unavailable', { error: String(err) });
    return {
      price: 0, change1d: 0, change5d: 0, above200ma: true,
      trend: 'sideways', bias: 'neutral',
      interpretation: 'SPY data unavailable — defaulting to neutral bias.',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Fetch VIX (CBOE Volatility Index) from Yahoo Finance — free, no API key.
 * VIX interpretation for trading:
 *   < 15  = low volatility, normal conditions, full position size
 *   15-25 = elevated, proceed with caution, 75% position size
 *   25-35 = high volatility, reduce size to 50%, tighten stops
 *   > 35  = extreme fear, do NOT trade (crash conditions)
 */
async function _fetchVix(): Promise<VixData> {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      }
    );
    if (!res.ok) throw new Error(`Yahoo VIX HTTP ${res.status}`);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice ?? result?.meta?.previousClose;

    if (!price) throw new Error('No VIX price in response');

    return classifyVix(parseFloat(price));
  } catch (err) {
    log.warn('VIX unavailable, using neutral fallback', { error: String(err) });
    return classifyVix(20);
  }
}

function classifyVix(value: number): VixData {
  let level: VixData['level'];
  let tradingAllowed: boolean;
  let positionSizeMultiplier: number;
  let interpretation: string;

  if (value < VIX_LOW_THRESHOLD) {
    level = 'low';
    tradingAllowed = true;
    positionSizeMultiplier = 1.0;
    interpretation = `VIX ${value.toFixed(1)} — Low volatility. Normal market conditions. Full position size allowed.`;
  } else if (value < VIX_ELEVATED_THRESHOLD) {
    level = 'elevated';
    tradingAllowed = true;
    positionSizeMultiplier = VIX_ELEVATED_SIZE_MULT;
    interpretation = `VIX ${value.toFixed(1)} — Elevated volatility. Proceed with caution. Use ${VIX_ELEVATED_SIZE_MULT * 100}% of normal position size.`;
  } else if (value < VIX_HIGH_THRESHOLD) {
    level = 'high';
    tradingAllowed = true;
    positionSizeMultiplier = VIX_HIGH_SIZE_MULT;
    interpretation = `VIX ${value.toFixed(1)} — High volatility. Reduce position size to ${VIX_HIGH_SIZE_MULT * 100}%. Tighten stop losses.`;
  } else {
    level = 'extreme';
    tradingAllowed = false;
    positionSizeMultiplier = VIX_EXTREME_SIZE_MULT;
    interpretation = `VIX ${value.toFixed(1)} — EXTREME volatility. Trading blocked. Wait for VIX to drop below ${VIX_HIGH_THRESHOLD}.`;
  }

  return { value, level, tradingAllowed, positionSizeMultiplier, interpretation, timestamp: new Date().toISOString() };
}

/**
 * Fetch CNN Fear & Greed Index (stocks market sentiment, 0-100)
 * Falls back to alternative.me (crypto) if CNN is unavailable
 */
export async function getFearGreedIndex(): Promise<FearGreedData> {
  // Cached for 1 hour — CNN rate-limits aggressively
  return fearGreedCache.getOrFetch('feargreed', () => _fetchFearGreedIndex());
}

async function _fetchFearGreedIndex(): Promise<FearGreedData> {
  // Try CNN Fear & Greed first (stock market)
  try {
    const response = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
          'Accept': 'application/json',
          'Referer': 'https://www.cnn.com/markets/fear-and-greed',
        },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      }
    );
    if (response.ok) {
      const data = await response.json();
      const score = data?.fear_and_greed?.score;
      const rating = data?.fear_and_greed?.rating;
      if (score !== undefined) {
        return {
          value: Math.round(score),
          classification: rating ?? classifyFearGreed(Math.round(score)),
          timestamp: new Date().toISOString(),
          source: 'cnn',
        };
      }
    }
  } catch {
    // fall through to backup
  }

  // Fallback: alternative.me (crypto-based but widely used)
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1', {
      headers: { 'User-Agent': 'TradingBot/1.0' },
      signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
    });
    if (response.ok) {
      const data = await response.json();
      const item = data.data[0];
      return {
        value: parseInt(item.value),
        classification: item.value_classification,
        timestamp: new Date(parseInt(item.timestamp) * 1000).toISOString(),
        source: 'fallback',
      };
    }
  } catch { /* ignore */ }

  return { value: 50, classification: 'Neutral', timestamp: new Date().toISOString(), source: 'fallback' };
}

export async function getVix(): Promise<VixData> {
  // Cached for 15 minutes — VIX changes slowly intraday
  return vixCache.getOrFetch('vix', () => _fetchVix());
}

function classifyFearGreed(value: number): string {
  if (value >= 75) return 'Extreme Greed';
  if (value >= 55) return 'Greed';
  if (value >= 45) return 'Neutral';
  if (value >= 25) return 'Fear';
  return 'Extreme Fear';
}

/**
 * Fetch Reddit sentiment for a stock symbol.
 * Searches r/stocks, r/investing, r/wallstreetbets for the ticker.
 */
export async function getRedditSentiment(symbol: string = 'AAPL'): Promise<{
  score: number;
  posts: RedditPost[];
}> {
  const bullishWords = ['bullish', 'buy', 'long', 'up', 'gain', 'surge', 'rally', 'breakout', 'calls', 'moon', 'beat', 'strong', 'growth'];
  const bearishWords = ['bearish', 'sell', 'short', 'down', 'loss', 'crash', 'drop', 'puts', 'miss', 'weak', 'correction', 'fear', 'overvalued'];

  // Search each subreddit for the ticker symbol
  const subreddits = ['stocks', 'investing', 'wallstreetbets'];
  const allPosts: RedditPost[] = [];
  let totalScore = 0;

  for (const sub of subreddits) {
    try {
      const response = await fetch(
        `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(symbol)}&restrict_sr=1&sort=hot&limit=10`,
        {
          headers: {
            'User-Agent': 'TradingBot/1.0 (by /u/tradingbot)',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
        }
      );
      if (!response.ok) continue;

      const data = await response.json();
      for (const child of (data?.data?.children ?? [])) {
        const post = child.data;
        const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
        const upvotes = post.ups || 0;

        let bullishCount = 0, bearishCount = 0;
        bullishWords.forEach(w => { if (text.includes(w)) bullishCount++; });
        bearishWords.forEach(w => { if (text.includes(w)) bearishCount++; });

        let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (bullishCount > bearishCount) sentiment = 'bullish';
        else if (bearishCount > bullishCount) sentiment = 'bearish';

        const postScore = (bullishCount - bearishCount) * Math.log(upvotes + 1);
        totalScore += postScore;

        allPosts.push({ title: post.title.substring(0, 100), score: upvotes, sentiment });
      }
    } catch { /* skip failed subreddit */ }
  }

  const normalizedScore = Math.max(-100, Math.min(100, totalScore * 2));
  return { score: normalizedScore, posts: allPosts.slice(0, 10) };
}

/**
 * Fetch stock market news headlines from Yahoo Finance and Reuters RSS feeds (free, no API key)
 */
export async function getStockNewsHeadlines(symbol?: string): Promise<NewsHeadline[]> {
  const feeds = [
    {
      url: symbol
        ? `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
        : 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
      source: 'Yahoo Finance',
    },
    {
      url: 'https://feeds.reuters.com/reuters/businessNews',
      source: 'Reuters',
    },
  ];

  const headlines: NewsHeadline[] = [];

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      });
      if (!response.ok) continue;

      const xml = await response.text();
      const titleRegex = /<item[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/gi;
      let match;
      let count = 0;
      while ((match = titleRegex.exec(xml)) !== null && count < 5) {
        const title = match[1].trim();
        if (title && title.length > 10) {
          headlines.push({ title, source: feed.source });
          count++;
        }
      }
    } catch { /* skip failed feed */ }
  }

  return headlines;
}

/** @deprecated use getStockNewsHeadlines */
export async function getCoinDeskHeadlines(): Promise<string[]> {
  const headlines = await getStockNewsHeadlines();
  return headlines.map(h => h.title);
}

/**
 * Get comprehensive market sentiment for a stock symbol or crypto pair.
 * pair can be a stock ticker (e.g. "AAPL") or a Kraken pair (e.g. "XXBTZCAD")
 */
/**
 * Calculate fee-aware position sizing for a stock trade.
 *
 * Rules based on IBKR Canada fee structure:
 *   - Fee per order = max($1.00, shares × $0.01), capped at 0.5% of trade value
 *   - Round trip (buy + sell) = 2× that fee
 *   - Min profit target = round trip fees × 2 (safe buffer above break-even)
 *   - Position size reduced by VIX multiplier and earnings risk multiplier
 *   - Stop loss = 1.5× ATR below entry (limits downside)
 *   - Take profit = 2× ATR above entry (2:1 risk/reward)
 *
 * @param symbol    Stock ticker
 * @param price     Current price per share
 * @param atr       14-period Average True Range in dollars
 * @param accountValue  Total account value (used to cap max position to 5%)
 * @param vixMultiplier  From VixData.positionSizeMultiplier (0.5, 0.75, or 1.0)
 * @param earningsRisk   From EarningsData.riskLevel
 */
export function calculatePositionSize(
  symbol: string,
  price: number,
  atr: number,
  accountValue: number,
  vixMultiplier: number = 1.0,
  earningsRisk: EarningsData['riskLevel'] = 'safe',
): PositionSizing {
  // Block if earnings too close
  if (earningsRisk === 'avoid') {
    return {
      symbol, price, atr, atrPercent: price > 0 ? (atr / price) * 100 : 0,
      baseShares: 0, finalShares: 0,
      stopLossPrice: 0, takeProfitPrice: 0,
      estimatedCost: 0, estimatedFees: 0, estimatedRoundTripFees: 0,
      minimumProfitNeeded: 0, expectedProfit: 0, worthTrading: false,
      interpretation: `⚠️ ${symbol} trading blocked — earnings within 2 days. Wait until after earnings.`,
    };
  }

  const atrPercent = price > 0 ? (atr / price) * 100 : 0;

  // Earnings caution: reduce size further when within 7 days
  const earningsMultiplier = earningsRisk === 'caution' ? EARNINGS_CAUTION_SIZE_MULT : 1.0;
  const combinedMultiplier = vixMultiplier * earningsMultiplier;

  // Max position = MAX_POSITION_FRACTION of account value, adjusted for risk
  const maxPositionValue = accountValue * MAX_POSITION_FRACTION * combinedMultiplier;
  const baseShares = price > 0 ? Math.floor(maxPositionValue / price) : 0;
  const finalShares = Math.max(1, baseShares);

  // Prices
  const stopLossPrice  = parseFloat((price - atr * SL_ATR_MULTIPLIER).toFixed(2));
  const takeProfitPrice = parseFloat((price + atr * TP_ATR_MULTIPLIER).toFixed(2));

  // IBKR Canada fee: max($1, shares × $0.01), capped at 0.5% of trade value
  const tradeValue = finalShares * price;
  const rawFee = Math.max(IB_MIN_FEE_CAD, finalShares * IB_FEE_PER_SHARE_CAD);
  const cappedFee = Math.min(rawFee, tradeValue * IB_MAX_FEE_FRACTION);
  const estimatedFees = parseFloat(cappedFee.toFixed(2));
  const estimatedRoundTripFees = parseFloat((estimatedFees * 2).toFixed(2));

  // Min profit = round trip fees × MIN_PROFIT_FEE_MULTIPLIER (buffer for slippage + edge uncertainty)
  const minimumProfitNeeded = parseFloat((estimatedRoundTripFees * MIN_PROFIT_FEE_MULTIPLIER).toFixed(2));

  // Expected profit if take-profit is hit
  const expectedProfit = parseFloat(((takeProfitPrice - price) * finalShares).toFixed(2));
  const worthTrading = expectedProfit > minimumProfitNeeded && finalShares >= 1;

  let interpretation: string;
  if (!worthTrading) {
    interpretation = `${symbol}: ${finalShares} shares @ $${price} — expected profit $${expectedProfit} does NOT clear $${minimumProfitNeeded} fee threshold. Skip trade.`;
  } else {
    interpretation = `${symbol}: Buy ${finalShares} shares @ $${price} | Stop $${stopLossPrice} | Target $${takeProfitPrice} | Fees ~$${estimatedRoundTripFees} round trip | Expected profit ~$${expectedProfit}`;
  }

  return {
    symbol, price, atr, atrPercent,
    baseShares, finalShares,
    stopLossPrice, takeProfitPrice,
    estimatedCost: parseFloat(tradeValue.toFixed(2)),
    estimatedFees,
    estimatedRoundTripFees,
    minimumProfitNeeded,
    expectedProfit,
    worthTrading,
    interpretation,
  };
}

export async function getMarketSentiment(pair: string): Promise<SentimentSummary> {
  // Resolve symbol: strip Kraken-style pair formatting for crypto, pass stocks as-is
  const cryptoMap: { [key: string]: string } = {
    'XXBTZCAD': 'BTC', 'XXBTZUSD': 'BTC',
    'XETHZCAD': 'ETH', 'XETHZUSD': 'ETH',
    'SOLCAD': 'SOL', 'SOLUSD': 'SOL',
    'XLTCZCAD': 'LTC', 'XLTCZUSD': 'LTC',
  };
  const symbol = cryptoMap[pair] ?? pair; // e.g. "AAPL", "MSFT", "BTC"

  // Fetch all data in parallel
  const [fearGreed, vix, spyTrend, earnings, redditData, newsHeadlines] = await Promise.all([
    getFearGreedIndex(),
    getVix(),
    getSpyTrend(),
    getEarningsData(symbol),
    getRedditSentiment(symbol),
    getStockNewsHeadlines(symbol),
  ]);

  // Fear & Greed: 0-100 (50 = neutral), convert to -100 to 100
  const fgScore = (fearGreed.value - 50) * 2;
  // VIX penalty: high volatility pushes score toward bearish
  const vixPenalty = vix.level === 'high' ? -15 : vix.level === 'extreme' ? -40 : 0;
  // SPY trend bonus/penalty: market direction matters for individual stocks
  const spyBonus = spyTrend.bias === 'buy' ? 10 : spyTrend.bias === 'sell' ? -20 : 0;
  // Earnings penalty: approaching earnings = uncertainty = reduce bullishness
  const earningsPenalty = earnings.riskLevel === 'avoid' ? -50 : earnings.riskLevel === 'caution' ? -15 : 0;
  const overallScore = (fgScore * 0.4) + (redditData.score * 0.6) + vixPenalty + spyBonus + earningsPenalty;

  const canTrade = vix.tradingAllowed && earnings.tradingAllowed;
  let overallSentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
  if (overallScore > BULLISH_SCORE_THRESHOLD && canTrade && spyTrend.bias !== 'sell') overallSentiment = 'Bullish';
  else if (overallScore < BEARISH_SCORE_THRESHOLD || !canTrade || spyTrend.trend === 'downtrend') overallSentiment = 'Bearish';

  return {
    fearGreed,
    vix,
    spyTrend,
    earnings,
    redditSentiment: redditData.score,
    redditPosts: redditData.posts.slice(0, 5),
    newsHeadlines: newsHeadlines.slice(0, 8),
    coinDeskHeadlines: newsHeadlines.slice(0, 5).map(h => h.title), // backward compat
    overallSentiment,
    overallScore,
  };
}

/**
 * Multi-timeframe analysis intervals
 */
export const TIMEFRAMES = [
  { label: '1m', interval: 1 },
  { label: '5m', interval: 5 },
  { label: '15m', interval: 15 },
  { label: '1h', interval: 60 },
  { label: '4h', interval: 240 },
  { label: '1D', interval: 1440 },
];

/**
 * Calculate Stochastic RSI
 */
export function calculateStochasticRSI(
  prices: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kPeriod: number = 3,
  dPeriod: number = 3
): { k: number; d: number; signal: 'overbought' | 'oversold' | 'neutral' } {
  if (prices.length < rsiPeriod + stochPeriod + kPeriod + dPeriod) {
    return { k: 50, d: 50, signal: 'neutral' };
  }

  // Calculate RSI values
  const rsiValues: number[] = [];
  for (let i = rsiPeriod; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    let gains = 0, losses = 0;
    for (let j = 1; j <= rsiPeriod; j++) {
      const change = slice[slice.length - j] - slice[slice.length - j - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    if (avgLoss === 0) { rsiValues.push(100); continue; }
    const rs = avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }

  if (rsiValues.length < stochPeriod) return { k: 50, d: 50, signal: 'neutral' };

  // Calculate Stochastic of RSI
  const stochValues: number[] = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRSI = Math.min(...slice);
    const maxRSI = Math.max(...slice);
    const range = maxRSI - minRSI;
    stochValues.push(range === 0 ? 50 : ((rsiValues[i] - minRSI) / range) * 100);
  }

  // Smooth with SMA
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < stochValues.length; i++) {
    const slice = stochValues.slice(i - kPeriod + 1, i + 1);
    kValues.push(slice.reduce((a, b) => a + b) / kPeriod);
  }

  const dValues: number[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const slice = kValues.slice(i - dPeriod + 1, i + 1);
    dValues.push(slice.reduce((a, b) => a + b) / dPeriod);
  }

  const k = kValues[kValues.length - 1] ?? 50;
  const d = dValues[dValues.length - 1] ?? 50;

  let signal: 'overbought' | 'oversold' | 'neutral' = 'neutral';
  if (k > 80 && d > 80) signal = 'overbought';
  else if (k < 20 && d < 20) signal = 'oversold';

  return { k, d, signal };
}

/**
 * Calculate Average True Range (ATR) - measures volatility
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // Initial ATR = simple average of first 'period' TRs
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b) / period;

  // Smooth with Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Calculate On-Balance Volume (OBV) - measures buying/selling pressure
 */
export function calculateOBV(closes: number[], volumes: number[]): {
  obv: number;
  trend: 'rising' | 'falling' | 'flat';
} {
  if (closes.length < 2) return { obv: 0, trend: 'flat' };

  let obv = 0;
  const obvValues: number[] = [0];

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvValues.push(obv);
  }

  // Determine trend from last 10 OBV values
  const recent = obvValues.slice(-10);
  const firstHalf = recent.slice(0, 5).reduce((a, b) => a + b) / 5;
  const secondHalf = recent.slice(5).reduce((a, b) => a + b) / 5;

  let trend: 'rising' | 'falling' | 'flat' = 'flat';
  const change = (secondHalf - firstHalf) / Math.abs(firstHalf || 1);
  if (change > 0.02) trend = 'rising';
  else if (change < -0.02) trend = 'falling';

  return { obv, trend };
}

/**
 * Calculate Ichimoku Cloud components
 */
export function calculateIchimoku(
  highs: number[],
  lows: number[],
  closes: number[]
): {
  tenkan: number;    // Conversion line (9-period)
  kijun: number;     // Base line (26-period)
  senkouA: number;   // Leading span A
  senkouB: number;   // Leading span B (52-period)
  signal: 'bullish' | 'bearish' | 'neutral';
} {
  const len = highs.length;
  if (len < 52) {
    const price = closes[len - 1] || 0;
    return { tenkan: price, kijun: price, senkouA: price, senkouB: price, signal: 'neutral' };
  }

  const midpoint = (period: number, offset: number = 0) => {
    const slice_h = highs.slice(len - period - offset, len - offset);
    const slice_l = lows.slice(len - period - offset, len - offset);
    return (Math.max(...slice_h) + Math.min(...slice_l)) / 2;
  };

  const tenkan = midpoint(9);
  const kijun = midpoint(26);
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = midpoint(52);

  const currentPrice = closes[len - 1];

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (currentPrice > Math.max(senkouA, senkouB) && tenkan > kijun) {
    signal = 'bullish';
  } else if (currentPrice < Math.min(senkouA, senkouB) && tenkan < kijun) {
    signal = 'bearish';
  }

  return { tenkan, kijun, senkouA, senkouB, signal };
}

/**
 * Enhanced technical signals with all new indicators
 */
export interface EnhancedTechnicalSignals {
  stochRSI: { k: number; d: number; signal: 'overbought' | 'oversold' | 'neutral' };
  atr: number;
  atrPercent: number; // ATR as % of price (volatility)
  obv: { obv: number; trend: 'rising' | 'falling' | 'flat' };
  ichimoku: { tenkan: number; kijun: number; senkouA: number; senkouB: number; signal: 'bullish' | 'bearish' | 'neutral' };
  volatilityLevel: 'low' | 'medium' | 'high';
}

/**
 * Calculate all enhanced indicators from price data
 */
export function calculateEnhancedIndicators(priceData: Array<{
  close: number;
  high: number;
  low: number;
  volume: number;
}>): EnhancedTechnicalSignals {
  const closes = priceData.map(d => d.close);
  const highs = priceData.map(d => d.high);
  const lows = priceData.map(d => d.low);
  const volumes = priceData.map(d => d.volume);
  const currentPrice = closes[closes.length - 1];

  const stochRSI = calculateStochasticRSI(closes);
  const atr = calculateATR(highs, lows, closes);
  const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  const obv = calculateOBV(closes, volumes);
  const ichimoku = calculateIchimoku(highs, lows, closes);

  // Classify volatility
  let volatilityLevel: 'low' | 'medium' | 'high' = 'medium';
  if (atrPercent < 1) volatilityLevel = 'low';
  else if (atrPercent > 3) volatilityLevel = 'high';

  return {
    stochRSI,
    atr,
    atrPercent,
    obv,
    ichimoku,
    volatilityLevel,
  };
}
