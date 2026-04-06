import { NextRequest, NextResponse } from 'next/server';
import { getMarketSentiment, calculatePositionSize } from '@/lib/market-intelligence';
import { getHistoricalPrices, analyzeTechnicalIndicators } from '@/lib/technical-indicators';
import { calculateEnhancedIndicators } from '@/lib/market-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache market intelligence for 60 seconds (external APIs are slow)
const cache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL = 60000; // 60 seconds

/**
 * GET /api/market-intelligence?pair=AAPL&timeframes=5,60,240&accountValue=100000
 * Returns sentiment (Fear&Greed, VIX, SPY trend, earnings), multi-timeframe analysis,
 * and fee-aware position sizing recommendation.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pair = searchParams.get('pair') || 'AAPL';
    const timeframesParam = searchParams.get('timeframes') || '5,60,240';
    const accountValue = parseFloat(searchParams.get('accountValue') || '100000');
    const timeframes = timeframesParam.split(',').map(Number).filter(n => !isNaN(n) && n > 0);

    // Check cache
    const cacheKey = `${pair}:${timeframesParam}:${accountValue}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cached.data, cached: true });
    }

    // Fetch sentiment + multi-timeframe in parallel
    const sentimentPromise = getMarketSentiment(pair);

    const timeframeAnalysisPromises = timeframes.map(async (interval) => {
      try {
        const priceData = await getHistoricalPrices(pair, interval);
        if (priceData.length < 50) {
          return { interval, error: 'Insufficient data' };
        }

        const technical = analyzeTechnicalIndicators(priceData);
        const enhanced = calculateEnhancedIndicators(priceData);
        const currentPrice = priceData[priceData.length - 1].close;

        const labelMap: { [key: number]: string } = {
          1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1D'
        };

        return {
          interval,
          label: labelMap[interval] || `${interval}m`,
          currentPrice,
          rsi: technical.rsi,
          rsiSignal: technical.rsiSignal,
          macdTrend: technical.macd.trend,
          macdHistogram: technical.macd.histogram,
          bbPosition: technical.bollingerBands.position,
          emaTrend: technical.ema.trend,
          overallSignal: technical.overallSignal,
          confidence: technical.confidence,
          volumeSpike: technical.volume.spike,
          stochRSI: enhanced.stochRSI,
          atr: enhanced.atr,
          atrPercent: enhanced.atrPercent,
          obvTrend: enhanced.obv.trend,
          ichimokuSignal: enhanced.ichimoku.signal,
          volatilityLevel: enhanced.volatilityLevel,
        };
      } catch (err) {
        return { interval, error: String(err) };
      }
    });

    const [sentiment, timeframeResults] = await Promise.all([
      sentimentPromise,
      Promise.all(timeframeAnalysisPromises),
    ]);

    // Multi-timeframe consensus
    const validTimeframes = timeframeResults.filter(t => !('error' in t));
    let buyCount = 0, sellCount = 0, holdCount = 0, totalConfidence = 0;

    for (const tf of validTimeframes) {
      if ('overallSignal' in tf) {
        if (tf.overallSignal === 'strong_buy' || tf.overallSignal === 'buy') buyCount++;
        else if (tf.overallSignal === 'strong_sell' || tf.overallSignal === 'sell') sellCount++;
        else holdCount++;
        totalConfidence += tf.confidence ?? 0;
      }
    }

    const avgConfidence = validTimeframes.length > 0 ? totalConfidence / validTimeframes.length : 0;
    let mtfConsensus: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (buyCount > sellCount && buyCount > holdCount) mtfConsensus = 'BUY';
    else if (sellCount > buyCount && sellCount > holdCount) mtfConsensus = 'SELL';

    // Fee-aware position sizing using best available ATR
    // Use ATR from the 1h timeframe if available, else fall back to first valid one
    const atrSource = validTimeframes.find(tf => 'atr' in tf && (tf as any).interval === 60)
      ?? validTimeframes.find(tf => 'atr' in tf);
    const atr = (atrSource as any)?.atr ?? 0;
    const currentPrice = (atrSource as any)?.currentPrice ?? 0;

    const positionSizing = calculatePositionSize(
      pair,
      currentPrice,
      atr,
      accountValue,
      sentiment.vix.positionSizeMultiplier,
      sentiment.earnings.riskLevel,
    );

    const response = {
      success: true,
      pair,
      timestamp: new Date().toISOString(),
      sentiment,
      timeframes: timeframeResults,
      consensus: {
        signal: mtfConsensus,
        buyCount,
        sellCount,
        holdCount,
        avgConfidence: Math.round(avgConfidence),
        totalTimeframes: validTimeframes.length,
      },
      positionSizing,
    };

    // Store in cache
    cache.set(cacheKey, { data: response, timestamp: Date.now() });

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Market intelligence error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch market intelligence' },
      { status: 500 }
    );
  }
}
