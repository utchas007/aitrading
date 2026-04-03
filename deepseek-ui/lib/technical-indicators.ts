/**
 * Technical Indicators Module
 * Implements RSI, MACD, Bollinger Bands, EMA, and other indicators
 */

export interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSignals {
  rsi: number;
  rsiSignal: 'oversold' | 'overbought' | 'neutral';
  macd: {
    macd: number;
    signal: number;
    histogram: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    position: 'above' | 'below' | 'inside';
  };
  ema: {
    ema12: number;
    ema26: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  volume: {
    current: number;
    average: number;
    spike: boolean;
  };
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Calculate RSI using smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(prices: number[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;

  // Calculate signal line (9-period EMA of MACD)
  const macdValues: number[] = [];
  for (let i = 26; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const e12 = calculateEMA(slice, 12);
    const e26 = calculateEMA(slice, 26);
    macdValues.push(e12 - e26);
  }

  const signal = calculateEMA(macdValues, 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } {
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b) / prices.length;
    return { upper: avg, middle: avg, lower: avg };
  }

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b) / period;

  const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);

  return {
    upper: middle + stdDev * standardDeviation,
    middle,
    lower: middle - stdDev * standardDeviation,
  };
}

/**
 * Analyze all technical indicators and generate signals
 */
export function analyzeTechnicalIndicators(priceData: PriceData[]): TechnicalSignals {
  const closePrices = priceData.map(d => d.close);
  const volumes = priceData.map(d => d.volume);
  const currentPrice = closePrices[closePrices.length - 1];

  // Calculate RSI
  const rsi = calculateRSI(closePrices);
  const rsiSignal = rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral';

  // Calculate MACD
  const macdData = calculateMACD(closePrices);
  const macdTrend =
    macdData.histogram > 0 ? 'bullish' : macdData.histogram < 0 ? 'bearish' : 'neutral';

  // Calculate Bollinger Bands
  const bb = calculateBollingerBands(closePrices);
  const bbPosition =
    currentPrice > bb.upper ? 'above' : currentPrice < bb.lower ? 'below' : 'inside';

  // Calculate EMAs
  const ema12 = calculateEMA(closePrices, 12);
  const ema26 = calculateEMA(closePrices, 26);
  const emaTrend = ema12 > ema26 ? 'bullish' : ema12 < ema26 ? 'bearish' : 'neutral';

  // Calculate volume
  const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
  const currentVolume = volumes[volumes.length - 1];
  const volumeSpike = currentVolume > avgVolume * 1.5;

  // Generate overall signal
  let signalScore = 0;
  let confidence = 0;

  // RSI signals (weight: 25%)
  if (rsiSignal === 'oversold') {
    signalScore += 2;
    confidence += 25;
  } else if (rsiSignal === 'overbought') {
    signalScore -= 2;
    confidence += 25;
  } else {
    confidence += 10;
  }

  // MACD signals (weight: 25%)
  if (macdTrend === 'bullish' && macdData.histogram > 0) {
    signalScore += 2;
    confidence += 25;
  } else if (macdTrend === 'bearish' && macdData.histogram < 0) {
    signalScore -= 2;
    confidence += 25;
  } else {
    confidence += 10;
  }

  // Bollinger Bands signals (weight: 20%)
  if (bbPosition === 'below') {
    signalScore += 1.5;
    confidence += 20;
  } else if (bbPosition === 'above') {
    signalScore -= 1.5;
    confidence += 20;
  } else {
    confidence += 10;
  }

  // EMA signals (weight: 20%)
  if (emaTrend === 'bullish') {
    signalScore += 1.5;
    confidence += 20;
  } else if (emaTrend === 'bearish') {
    signalScore -= 1.5;
    confidence += 20;
  } else {
    confidence += 10;
  }

  // Volume spike bonus (weight: 10%)
  if (volumeSpike) {
    signalScore += signalScore > 0 ? 1 : -1; // Amplify existing signal
    confidence += 10;
  }

  // Determine overall signal
  let overallSignal: TechnicalSignals['overallSignal'];
  if (signalScore >= 5) overallSignal = 'strong_buy';
  else if (signalScore >= 2) overallSignal = 'buy';
  else if (signalScore <= -5) overallSignal = 'strong_sell';
  else if (signalScore <= -2) overallSignal = 'sell';
  else overallSignal = 'neutral';

  return {
    rsi,
    rsiSignal,
    macd: {
      ...macdData,
      trend: macdTrend,
    },
    bollingerBands: {
      ...bb,
      position: bbPosition,
    },
    ema: {
      ema12,
      ema26,
      trend: emaTrend,
    },
    volume: {
      current: currentVolume,
      average: avgVolume,
      spike: volumeSpike,
    },
    overallSignal,
    confidence: Math.min(confidence, 100),
  };
}

/**
 * Get historical price data from Interactive Brokers (via ib_service.py)
 */
export async function getHistoricalPrices(
  symbol: string,
  interval: number = 5,  // minutes
): Promise<PriceData[]> {
  // Map interval (minutes) to IB bar size + duration that yields 100+ bars
  let barSize: string;
  let duration: string;
  if (interval <= 1)        { barSize = '1 min';   duration = '1 D'; }
  else if (interval <= 5)   { barSize = '5 mins';  duration = '3 D'; }
  else if (interval <= 15)  { barSize = '15 mins'; duration = '5 D'; }
  else if (interval <= 60)  { barSize = '1 hour';  duration = '10 D'; }
  else                      { barSize = '1 day';   duration = '3 M'; }

  // Use the OHLC API route which has Yahoo Finance fallback built in
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  const params = new URLSearchParams({ symbol, barSize, duration });

  try {
    const response = await fetch(`${baseUrl}/api/ib/ohlc?${params}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`OHLC route ${response.status}`);
    const data: { success: boolean; bars: { time: string; open: number; high: number; low: number; close: number; volume: number }[] } = await response.json();
    if (!data.success || !data.bars?.length) throw new Error('No bars returned');

    return data.bars.map(bar => ({
      timestamp: new Date(bar.time).getTime(),
      open:   bar.open,
      high:   bar.high,
      low:    bar.low,
      close:  bar.close,
      volume: bar.volume,
    }));
  } catch (error) {
    console.error(`Failed to fetch historical prices for ${symbol}:`, error);
    return [];
  }
}
