/**
 * Signal Generator
 *
 * Produces a TradeSignal by combining:
 *   1. Technical indicators (RSI, MACD, Bollinger Bands, EMA, volume)
 *   2. Enhanced indicators (StochRSI, ATR, OBV, Ichimoku)
 *   3. Market sentiment (Fear & Greed, VIX, SPY trend, earnings)
 *   4. AI analysis (DeepSeek via /api/trading/analyze)
 *   5. Position sizing (fee-aware, VIX-adjusted, earnings-adjusted)
 *   6. Micro-filters (volume, BB+RSI, VIX+MACD)
 *
 * This module is a pure function extractor from TradingEngine.generateSignal().
 * It does NOT interact with IB or persist anything to the DB.
 */

import { analyzeTechnicalIndicators, getHistoricalPrices, type TechnicalSignals, type PriceData } from '../technical-indicators';
import {
  getMarketSentiment, calculateEnhancedIndicators, calculatePositionSize,
  type SentimentSummary,
} from '../market-intelligence';
import { getWorldMonitorSummary, getMarketContextForAI } from '../worldmonitor-data';
import { logActivity } from '../activity-logger';
import { createLogger } from '../logger';
import {
  TECHNICAL_WEIGHT, AI_WEIGHT, AI_ONLY_MIN_CONFIDENCE, AGREEMENT_CONFIDENCE_BOOST,
  VOLUME_CONFIRMATION_RATIO, BB_BELOW_RSI_MAX, BB_ABOVE_RSI_MIN,
  ELEVATED_VIX_MACD_THRESHOLD, BEARISH_SENTIMENT_CONFIDENCE_PENALTY,
} from '../constants';

const log = createLogger('signal-generator');

export interface TradeSignal {
  pair: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  reasoning: string;
  technicalSignals: TechnicalSignals;
  timestamp: number;
  marketSentiment?: SentimentSummary | null;
}

export interface GenerateSignalOptions {
  pair: string;
  marketData: Record<string, { price: number; volume: number; change24h: string }>;
  availableCash: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  analyzeUrl: string; // e.g. http://localhost:3001/api/trading/analyze
}

/** Async DB write — persist OHLCV candles, fire and forget */
export async function savePriceCandles(
  pair: string,
  interval: number,
  priceData: PriceData[],
): Promise<void> {
  if (!priceData.length) return;
  try {
    const { prisma } = await import('../db');
    await Promise.all(
      priceData.map((bar) =>
        prisma.priceCandle.upsert({
          where: { pair_interval_time: { pair, interval, time: Math.floor(bar.timestamp / 1000) } },
          update: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
          create: { pair, interval, time: Math.floor(bar.timestamp / 1000), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
        }),
      ),
    );
  } catch (e: any) {
    const isConnection = e?.code === 'P1001' || e?.message?.includes('connect');
    const isConstraint = e?.code?.startsWith('P2');
    const kind = isConnection ? 'DB_CONNECTION' : isConstraint ? 'DB_CONSTRAINT' : 'DB_ERROR';
    log.error(`${kind} in savePriceCandles`, { pair, interval, bars: priceData.length, error: e?.message ?? String(e) });
  }
}

/** Async DB write — persist signal to TradingSignal table */
export async function saveSignalToDb(
  signal: TradeSignal,
  marketSentiment?: SentimentSummary | null,
): Promise<void> {
  try {
    const { prisma } = await import('../db');
    await prisma.tradingSignal.create({
      data: {
        pair:             signal.pair,
        action:           signal.action,
        confidence:       signal.confidence,
        entryPrice:       signal.entryPrice,
        stopLoss:         signal.stopLoss,
        takeProfit:       signal.takeProfit,
        positionSize:     signal.positionSize,
        reasoning:        signal.reasoning,
        rsi:              signal.technicalSignals.rsi,
        rsiSignal:        signal.technicalSignals.rsiSignal,
        macdTrend:        signal.technicalSignals.macd.trend,
        bbPosition:       signal.technicalSignals.bollingerBands.position,
        emaTrend:         signal.technicalSignals.ema.trend,
        volumeSpike:      signal.technicalSignals.volume.spike,
        fearGreedValue:   marketSentiment?.fearGreed.value,
        fearGreedClass:   marketSentiment?.fearGreed.classification,
        overallSentiment: marketSentiment?.overallSentiment,
        executed:         false,
      },
    });
  } catch (e: any) {
    const isConnection = e?.code === 'P1001' || e?.message?.includes('connect');
    const isConstraint = e?.code?.startsWith('P2');
    const kind = isConnection ? 'DB_CONNECTION' : isConstraint ? 'DB_CONSTRAINT' : 'DB_ERROR';
    log.error(`${kind} in saveSignalToDb`, { pair: signal.pair, action: signal.action, error: e?.message ?? String(e) });
  }
}

/** Call the AI analysis endpoint. Returns null on failure — non-fatal. */
async function getAISentimentAnalysis(
  pair: string,
  news: unknown[],
  marketData: unknown,
  technicals: unknown,
  worldContext: string | undefined,
  analyzeUrl: string,
): Promise<{ sentiment: string; signal: string; confidence: number; keyFactors?: string[]; recommendation?: string } | null> {
  try {
    const isStock = /^[A-Z]{1,5}$/.test(pair);
    const response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair,
        news: (news as unknown[]).slice(0, 10),
        marketData,
        assetType: isStock ? 'stock' : 'crypto',
        technicals: technicals ?? null,
        worldContext: worldContext ?? null,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.analysis;
  } catch {
    log.warn('AI sentiment analysis not available', { pair });
    return null;
  }
}

/** Fetch World Monitor news — returns empty array on failure */
async function fetchWorldMonitorNews(worldMonitorUrl: string): Promise<unknown[]> {
  try {
    const response = await fetch(`${worldMonitorUrl}/api/worldmonitor/news`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.news as unknown[]) || [];
  } catch {
    return [];
  }
}

/** Generate a reasoning string from technical + AI signals */
export function generateReasoning(
  signals: TechnicalSignals,
  aiAnalysis?: { sentiment: string; confidence: number; keyFactors?: string[]; recommendation?: string } | null,
): string {
  const reasons: string[] = [];

  if (signals.rsiSignal === 'oversold') {
    reasons.push(`RSI at ${signals.rsi.toFixed(1)} indicates oversold conditions`);
  } else if (signals.rsiSignal === 'overbought') {
    reasons.push(`RSI at ${signals.rsi.toFixed(1)} indicates overbought conditions`);
  }

  if (signals.macd.trend === 'bullish') reasons.push('MACD showing bullish momentum');
  else if (signals.macd.trend === 'bearish') reasons.push('MACD showing bearish momentum');

  if (signals.bollingerBands.position === 'below') reasons.push('Price below lower Bollinger Band (potential bounce)');
  else if (signals.bollingerBands.position === 'above') reasons.push('Price above upper Bollinger Band (potential reversal)');

  if (signals.volume.spike) reasons.push('Unusual volume spike detected');

  if (aiAnalysis) {
    reasons.push(`AI Sentiment: ${aiAnalysis.sentiment} (${aiAnalysis.confidence}% confidence)`);
    if (aiAnalysis.keyFactors?.length) reasons.push(`Key factors: ${aiAnalysis.keyFactors.slice(0, 2).join(', ')}`);
    if (aiAnalysis.recommendation) {
      const short = aiAnalysis.recommendation.substring(0, 100);
      reasons.push(`AI: ${short}${aiAnalysis.recommendation.length > 100 ? '...' : ''}`);
    }
  }

  return reasons.join('. ') || 'Technical indicators aligned';
}

/**
 * Generate a complete TradeSignal for a given pair.
 * Does NOT execute any orders — purely analytical.
 */
export async function generateSignal(opts: GenerateSignalOptions): Promise<TradeSignal> {
  const { pair, marketData, availableCash, stopLossPercent, takeProfitPercent, analyzeUrl } = opts;
  const worldMonitorUrl = process.env.WORLDMONITOR_URL || 'http://localhost:3000';

  const priceData = await getHistoricalPrices(pair, 1440);

  // Fire-and-forget candle persist
  void savePriceCandles(pair, 1440, priceData).catch((e) =>
    log.error('savePriceCandles escaped internal catch', { error: String(e) }),
  );

  if (priceData.length < 50) {
    throw new Error(`Insufficient price data for ${pair}`);
  }

  const technicalSignals = analyzeTechnicalIndicators(priceData);
  const currentPrice = priceData[priceData.length - 1].close;

  const news = await fetchWorldMonitorNews(worldMonitorUrl);

  const technicalsForAI = {
    rsi:           technicalSignals.rsi,
    rsiSignal:     technicalSignals.rsiSignal,
    macd:          technicalSignals.macd.trend,
    overallSignal: technicalSignals.overallSignal,
    confidence:    technicalSignals.confidence,
    price:         currentPrice,
    change:
      priceData.length >= 2
        ? (((currentPrice - priceData[priceData.length - 2].close) / priceData[priceData.length - 2].close) * 100).toFixed(2)
        : '0.00',
  };

  // World Monitor context (optional — non-fatal)
  let worldContext: string | undefined;
  let worldMonitorData: Awaited<ReturnType<typeof getWorldMonitorSummary>> | null = null;
  try {
    worldMonitorData = await getWorldMonitorSummary();
    worldContext = await getMarketContextForAI();
    if (worldMonitorData.geopoliticalRisk.level !== 'low') {
      logActivity.warning(
        `🌍 Geopolitical Risk: ${worldMonitorData.geopoliticalRisk.level.toUpperCase()} ` +
        `(${worldMonitorData.geopoliticalRisk.score}/100) | ${worldMonitorData.geopoliticalRisk.marketImpact}`,
      );
    }
    const oil = worldMonitorData.commodities.find((c) => c.name.includes('Oil'));
    if (oil && Math.abs(oil.changePercent) > 2) {
      logActivity.info(
        `🛢️ Oil ${oil.changePercent > 0 ? 'up' : 'down'} ${Math.abs(oil.changePercent).toFixed(1)}% - may impact energy sector`,
      );
    }
  } catch {
    // non-fatal
  }

  const aiAnalysis = await getAISentimentAnalysis(pair, news, marketData, technicalsForAI, worldContext, analyzeUrl);
  if (aiAnalysis) {
    logActivity.info(`🤖 AI Sentiment for ${pair}: ${aiAnalysis.sentiment} | Signal: ${aiAnalysis.signal} | Confidence: ${aiAnalysis.confidence}%`);
  }

  const enhanced = calculateEnhancedIndicators(priceData);
  logActivity.calculating(
    `${pair}: StochRSI K=${enhanced.stochRSI.k.toFixed(1)} D=${enhanced.stochRSI.d.toFixed(1)} (${enhanced.stochRSI.signal}) | ` +
    `ATR=${enhanced.atrPercent.toFixed(2)}% | OBV=${enhanced.obv.trend} | Ichimoku=${enhanced.ichimoku.signal} | Volatility=${enhanced.volatilityLevel}`,
  );

  // ── Market sentiment ──────────────────────────────────────────────────────
  let marketSentiment: SentimentSummary | null = null;
  try {
    marketSentiment = await getMarketSentiment(pair);
    const { fearGreed, vix, spyTrend, earnings } = marketSentiment;
    logActivity.info(
      `😱 Fear&Greed: ${fearGreed.value} (${fearGreed.classification}) | VIX: ${vix.value.toFixed(1)} ${vix.level} | ` +
      `SPY: ${spyTrend.trend} | Earnings: ${earnings.riskLevel}`,
    );
    logActivity.info(
      `📊 Market bias: ${marketSentiment.overallSentiment} (score: ${marketSentiment.overallScore.toFixed(0)}) | ` +
      `Size mult: ${vix.positionSizeMultiplier}x`,
    );

    if (!vix.tradingAllowed) {
      logActivity.warning(`🚫 ${pair}: VIX ${vix.value.toFixed(1)} too high — trading blocked`);
      return { pair, action: 'hold', confidence: 0, entryPrice: currentPrice, stopLoss: currentPrice, takeProfit: currentPrice, positionSize: 0, reasoning: vix.interpretation, technicalSignals, timestamp: Date.now() };
    }
    if (!earnings.tradingAllowed) {
      logActivity.warning(`🚫 ${pair}: ${earnings.interpretation}`);
      return { pair, action: 'hold', confidence: 0, entryPrice: currentPrice, stopLoss: currentPrice, takeProfit: currentPrice, positionSize: 0, reasoning: earnings.interpretation, technicalSignals, timestamp: Date.now() };
    }
    if (spyTrend.trend === 'downtrend') {
      logActivity.warning(`⚠️ ${pair}: SPY in downtrend — suppressing BUY signals`);
    }
  } catch {
    logActivity.warning(`Market intelligence unavailable for ${pair} — using technicals only`);
  }

  // ── Determine action ──────────────────────────────────────────────────────
  let action: 'buy' | 'sell' | 'hold' = 'hold';
  let confidence = technicalSignals.confidence;

  if (aiAnalysis) {
    const aiScore = aiAnalysis.signal === 'BUY' ? aiAnalysis.confidence : aiAnalysis.signal === 'SELL' ? 100 - aiAnalysis.confidence : 50;
    confidence = Math.round((technicalSignals.confidence * TECHNICAL_WEIGHT) + (aiScore * AI_WEIGHT));

    if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') {
      if (aiAnalysis.signal === 'BUY') { action = 'buy'; confidence = Math.min(confidence + AGREEMENT_CONFIDENCE_BOOST, 100); }
      else if (aiAnalysis.signal === 'SELL') { action = 'hold'; confidence = 50; }
      else { action = 'buy'; }
    } else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') {
      if (aiAnalysis.signal === 'SELL') { action = 'sell'; confidence = Math.min(confidence + AGREEMENT_CONFIDENCE_BOOST, 100); }
      else if (aiAnalysis.signal === 'BUY') { action = 'hold'; confidence = 50; }
      else { action = 'sell'; }
    } else {
      if (aiAnalysis.signal === 'BUY'  && aiAnalysis.confidence >= AI_ONLY_MIN_CONFIDENCE) action = 'buy';
      if (aiAnalysis.signal === 'SELL' && aiAnalysis.confidence >= AI_ONLY_MIN_CONFIDENCE) action = 'sell';
    }
  } else {
    if (technicalSignals.overallSignal === 'strong_buy'  || technicalSignals.overallSignal === 'buy')  action = 'buy';
    if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') action = 'sell';
  }

  // SPY downtrend: block BUY
  if (action === 'buy' && marketSentiment?.spyTrend.trend === 'downtrend') {
    logActivity.warning(`${pair}: SPY downtrend — BUY blocked. SELL signals still allowed.`);
    action = 'hold';
  }

  // Bearish sentiment penalty
  if (marketSentiment?.overallSentiment === 'Bearish' && action === 'buy') {
    confidence = Math.max(0, confidence - BEARISH_SENTIMENT_CONFIDENCE_PENALTY);
  }

  // Micro-filter: volume
  if (action !== 'hold') {
    const volumeRatio = technicalSignals.volume.average > 0 ? technicalSignals.volume.current / technicalSignals.volume.average : 1;
    if (volumeRatio < VOLUME_CONFIRMATION_RATIO) {
      logActivity.warning(`${pair}: Weak volume (${volumeRatio.toFixed(1)}× avg) — HOLD.`);
      action = 'hold';
    }
  }

  // Micro-filter: BB + RSI
  if (action === 'buy' && technicalSignals.bollingerBands.position === 'below' && technicalSignals.rsi >= BB_BELOW_RSI_MAX) {
    logActivity.warning(`${pair}: Below BB but RSI not oversold (${technicalSignals.rsi.toFixed(0)}) — HOLD.`);
    action = 'hold';
  }
  if (action === 'sell' && technicalSignals.bollingerBands.position === 'above' && technicalSignals.rsi <= BB_ABOVE_RSI_MIN) {
    logActivity.warning(`${pair}: Above BB but RSI not overbought (${technicalSignals.rsi.toFixed(0)}) — HOLD.`);
    action = 'hold';
  }

  // Micro-filter: VIX + MACD
  if (action !== 'hold' && (marketSentiment?.vix.value ?? 0) > ELEVATED_VIX_MACD_THRESHOLD && technicalSignals.macd.histogram <= 0) {
    logActivity.warning(`${pair}: Elevated VIX + MACD histogram ≤ 0 — no momentum. HOLD.`);
    action = 'hold';
  }

  // ── Position sizing ───────────────────────────────────────────────────────
  const vixMultiplier  = marketSentiment?.vix.positionSizeMultiplier ?? 1.0;
  const earningsRisk   = marketSentiment?.earnings.riskLevel ?? 'safe';
  const sizing         = calculatePositionSize(pair, currentPrice, enhanced.atr, availableCash, vixMultiplier, earningsRisk);

  logActivity.info(`💰 ${sizing.interpretation}`);

  if (action !== 'hold' && !sizing.worthTrading) {
    logActivity.warning(`${pair}: Trade not worth it — expected profit $${sizing.expectedProfit} < min $${sizing.minimumProfitNeeded} after fees`);
    action = 'hold';
  }

  let positionSize = sizing.finalShares;
  if (positionSize < 1) {
    logActivity.warning(`${pair}: Position size < 1 share. Skipping.`);
    action = 'hold';
    positionSize = 0;
  }

  const stopLoss   = action === 'buy' ? sizing.stopLossPrice  : currentPrice * (1 + stopLossPercent);
  const takeProfit = action === 'buy' ? sizing.takeProfitPrice : currentPrice * (1 - takeProfitPercent);

  return {
    pair,
    action,
    confidence,
    entryPrice:       currentPrice,
    stopLoss,
    takeProfit,
    positionSize,
    reasoning:        generateReasoning(technicalSignals, aiAnalysis),
    technicalSignals,
    timestamp:        Date.now(),
    marketSentiment,
  };
}
