/**
 * Automated Trading Engine
 * Monitors markets, generates signals, and executes trades automatically
 */

import { createIBClient } from './ib-client';
import { analyzeTechnicalIndicators, getHistoricalPrices, TechnicalSignals } from './technical-indicators';
import { createRiskManager, RiskManager } from './risk-management';
import { logActivity } from './activity-logger';
import {
  getMarketSentiment, calculateEnhancedIndicators, calculatePositionSize,
  SentimentSummary,
} from './market-intelligence';
import {
  getWorldMonitorSummary, getMarketContextForAI, GeopoliticalRisk,
} from './worldmonitor-data';

// Async DB write — fire and forget, never blocks the bot
async function saveSignalToDb(signal: TradeSignal, marketSentiment?: SentimentSummary | null): Promise<void> {
  try {
    const { prisma } = await import('./db');
    await prisma.tradingSignal.create({
      data: {
        pair: signal.pair,
        action: signal.action,
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        positionSize: signal.positionSize,
        reasoning: signal.reasoning,
        rsi: signal.technicalSignals.rsi,
        rsiSignal: signal.technicalSignals.rsiSignal,
        macdTrend: signal.technicalSignals.macd.trend,
        bbPosition: signal.technicalSignals.bollingerBands.position,
        emaTrend: signal.technicalSignals.ema.trend,
        volumeSpike: signal.technicalSignals.volume.spike,
        fearGreedValue: marketSentiment?.fearGreed.value,
        fearGreedClass: marketSentiment?.fearGreed.classification,
        overallSentiment: marketSentiment?.overallSentiment,
        executed: false,
      },
    });
  } catch (e) {
    console.error('Failed to save signal to DB:', e);
  }
}

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
}

export interface ActivePosition {
  txid: string;
  pair: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  volume: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
}

export interface TradingEngineConfig {
  pairs: string[];
  checkInterval: number; // milliseconds
  minConfidence: number; // 0-100
  maxPositions: number;
  riskPerTrade: number; // 0-1 (e.g., 0.25 = 25%)
  stopLossPercent: number; // 0-1
  takeProfitPercent: number; // 0-1
  autoExecute: boolean;
  tradingFeePercent: number; // Transaction fee per trade (e.g., 0.0026 = 0.26%)
  minProfitMargin: number; // Minimum profit margin above fees (e.g., 0.03 = 3%)
  tradeCooldownHours: number; // Hours to wait before re-trading same pair
  maxDailyTrades: number; // Maximum trades per day
}

export class TradingEngine {
  private config: TradingEngineConfig;
  private riskManager: RiskManager;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;
  private activePositions: Map<string, ActivePosition> = new Map();
  private lastTradeTime: Map<string, number> = new Map(); // Track last trade time per pair
  private dailyTradeCount: number = 0;
  private lastResetDate: string = new Date().toDateString();

  constructor(config: Partial<TradingEngineConfig> = {}) {
    this.config = {
      pairs: config.pairs || ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
      checkInterval: config.checkInterval || 30 * 60 * 1000, // 30 minutes
      minConfidence: config.minConfidence || 85,
      maxPositions: config.maxPositions || 4,
      riskPerTrade: config.riskPerTrade || 0.10, // 10% of available cash per trade
      stopLossPercent: config.stopLossPercent || 0.05, // 5% stop loss
      takeProfitPercent: config.takeProfitPercent || 0.10, // 10% take profit
      autoExecute: config.autoExecute || false,
      tradingFeePercent: config.tradingFeePercent || 0.0005, // IB ~$0.005/share ≈ 0.05% round-trip
      minProfitMargin: config.minProfitMargin || 0.02, // 2% minimum profit above fees
      tradeCooldownHours: config.tradeCooldownHours || 4,
      maxDailyTrades: config.maxDailyTrades || 4,
    };

    this.riskManager = createRiskManager({
      maxPositionSize: this.config.riskPerTrade,
      stopLossPercent: this.config.stopLossPercent,
      takeProfitPercent: this.config.takeProfitPercent,
      maxOpenPositions: this.config.maxPositions,
      minConfidence: this.config.minConfidence,
    });
  }

  /**
   * Start the trading engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Trading engine is already running');
      return;
    }

    console.log('🚀 Starting trading engine...');
    console.log(`Monitoring pairs: ${this.config.pairs.join(', ')}`);
    console.log(`Check interval: ${this.config.checkInterval / 1000}s`);
    console.log(`Min confidence: ${this.config.minConfidence}%`);
    console.log(`Auto-execute: ${this.config.autoExecute}`);

    this.isRunning = true;

    // Run initial check
    await this.checkMarkets();

    // Set up interval for continuous monitoring
    this.intervalId = setInterval(() => {
      this.checkMarkets();
    }, this.config.checkInterval);
  }

  /**
   * Stop the trading engine
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('Trading engine is not running');
      return;
    }

    console.log('🛑 Stopping trading engine...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Check all markets and generate trading signals
   */
  private async checkMarkets(): Promise<void> {
    console.log(`\n📊 Checking markets at ${new Date().toLocaleTimeString()}...`);
    logActivity.analyzing(`Checking markets for ${this.config.pairs.length} pairs...`);

    try {
      // Reset daily trade counter if new day
      this.resetDailyTradeCountIfNeeded();
      
      // Save portfolio snapshot before checking markets
      await this.savePortfolioSnapshot();
      
      // Update active positions
      await this.updatePositions();

      // Check each trading pair — 12s delay between symbols to respect IB pacing limits
      for (const pair of this.config.pairs) {
        try {
          logActivity.analyzing(`Analyzing ${pair}...`);
          await new Promise(r => setTimeout(r, 12000)); // IB allows ~6 req/min per symbol
          const signal = await this.generateSignal(pair);
          
          // Log the signal details
          logActivity.calculating(`${pair}: RSI ${signal.technicalSignals.rsi.toFixed(1)}, MACD ${signal.technicalSignals.macd.trend}, Confidence ${signal.confidence}%`);
          
          if (signal.action !== 'hold' && signal.confidence >= this.config.minConfidence) {
            // Check if trade is allowed (cooldown, daily limit, profit margin)
            const tradeAllowed = this.isTradeAllowed(signal);
            
            if (!tradeAllowed.allowed) {
              logActivity.warning(`❌ Trade blocked for ${pair}: ${tradeAllowed.reason}`);
              console.log(`\n❌ Trade blocked for ${pair}: ${tradeAllowed.reason}`);
              continue;
            }
            
            console.log(`\n🎯 Signal generated for ${pair}:`);
            console.log(`   Action: ${signal.action.toUpperCase()}`);
            console.log(`   Confidence: ${signal.confidence}%`);
            console.log(`   Entry: $${signal.entryPrice.toFixed(2)}`);
            console.log(`   Stop Loss: $${signal.stopLoss.toFixed(2)}`);
            console.log(`   Take Profit: $${signal.takeProfit.toFixed(2)}`);
            console.log(`   Position Size: ${signal.positionSize.toFixed(8)}`);
            console.log(`   Expected Profit: ${tradeAllowed.expectedProfitPercent?.toFixed(2)}% (after fees)`);
            console.log(`   Reasoning: ${signal.reasoning}`);

            logActivity.info(`🎯 Signal: ${signal.action.toUpperCase()} ${pair} | Confidence: ${signal.confidence}% | Entry: $${signal.entryPrice.toFixed(2)}`);
            logActivity.info(`📊 ${signal.reasoning}`);
            logActivity.info(`💰 Expected profit: ${tradeAllowed.expectedProfitPercent?.toFixed(2)}% after ${(this.config.tradingFeePercent * 200).toFixed(2)}% fees`);
            
            // Save signal to database
            saveSignalToDb(signal, marketSentiment).catch(() => {});

            if (this.config.autoExecute) {
              await this.executeSignal(signal);
            } else {
              logActivity.warning(`Validation mode: Would ${signal.action.toUpperCase()} ${pair} at $${signal.entryPrice.toFixed(2)}`);
            }
          } else if (signal.action === 'hold') {
            logActivity.info(`${pair}: HOLD | Confidence: ${signal.confidence}% | ${signal.reasoning}`);
          }
        } catch (error) {
          console.error(`Error checking ${pair}:`, error);
          logActivity.error(`Failed to analyze ${pair}: ${error}`);
        }
      }
      
      logActivity.completed(`Market check complete. Active positions: ${this.activePositions.size}`);
    } catch (error) {
      console.error('Error in checkMarkets:', error);
      logActivity.error(`Market check failed: ${error}`);
    }
  }

  /**
   * Fetch news from World Monitor
   */
  private async fetchWorldMonitorNews(): Promise<any[]> {
    try {
      const response = await fetch('http://192.168.2.232:3000/api/worldmonitor/news');
      if (!response.ok) {
        console.warn('Failed to fetch World Monitor news, continuing with technical analysis only');
        return [];
      }
      const data = await response.json();
      return data.news || [];
    } catch (error) {
      console.warn('World Monitor not available, continuing with technical analysis only');
      return [];
    }
  }

  /**
   * Get AI sentiment analysis — supports both stocks and crypto
   */
  private async getAISentimentAnalysis(pair: string, news: any[], marketData: any, technicals?: any, worldContext?: string): Promise<any> {
    try {
      // Detect if this is a stock symbol (uppercase letters only, 1-5 chars, no numbers)
      const isStock = /^[A-Z]{1,5}$/.test(pair);

      const response = await fetch('http://localhost:3001/api/trading/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair,
          news: news.slice(0, 10),
          marketData,
          assetType: isStock ? 'stock' : 'crypto',
          technicals: technicals ?? null,
          worldContext: worldContext ?? null, // Global market context from World Monitor
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.analysis;
    } catch (error) {
      console.warn('AI sentiment analysis not available');
      return null;
    }
  }

  /**
   * Generate trading signal for a pair
   */
  async generateSignal(pair: string): Promise<TradeSignal> {
    // Use daily bars — reliable, no IB pacing issues, good for swing trading signals
    const priceData = await getHistoricalPrices(pair, 1440);
    
    if (priceData.length < 50) {
      throw new Error(`Insufficient price data for ${pair}`);
    }

    // Analyze technical indicators
    const technicalSignals = analyzeTechnicalIndicators(priceData);
    const currentPrice = priceData[priceData.length - 1].close;

    // Fetch World Monitor news for fundamental analysis
    const news = await this.fetchWorldMonitorNews();

    // Get current market data for AI analysis via IB
    const ib = createIBClient();
    const marketData: any = {};
    for (const symbol of this.config.pairs) {
      try {
        const t = await ib.getTicker(symbol);
        marketData[symbol] = {
          price:    t.last ?? t.close ?? currentPrice,
          volume:   t.volume ?? 0,
          change24h: '0',
        };
      } catch {
        marketData[symbol] = { price: currentPrice, volume: 0, change24h: '0' };
      }
    }

    // Get AI sentiment analysis — pass technicals so AI has full context
    let aiAnalysis = null;
    const technicalsForAI = {
      rsi: technicalSignals.rsi,
      rsiSignal: technicalSignals.rsiSignal,
      macd: technicalSignals.macd.trend,
      overallSignal: technicalSignals.overallSignal,
      confidence: technicalSignals.confidence,
      price: currentPrice,
      change: priceData.length >= 2
        ? (((currentPrice - priceData[priceData.length - 2].close) / priceData[priceData.length - 2].close) * 100).toFixed(2)
        : '0.00',
    };

    // Get World Monitor global context for AI analysis
    let worldContext: string | undefined;
    let worldMonitorData: Awaited<ReturnType<typeof getWorldMonitorSummary>> | null = null;
    try {
      worldMonitorData = await getWorldMonitorSummary();
      worldContext = await getMarketContextForAI();
      
      // Log geopolitical risk if elevated
      if (worldMonitorData.geopoliticalRisk.level !== 'low') {
        logActivity.warning(`🌍 Geopolitical Risk: ${worldMonitorData.geopoliticalRisk.level.toUpperCase()} (${worldMonitorData.geopoliticalRisk.score}/100) | ${worldMonitorData.geopoliticalRisk.marketImpact}`);
      }
      
      // Log commodity prices impact
      const oil = worldMonitorData.commodities.find(c => c.name.includes('Oil'));
      if (oil && Math.abs(oil.changePercent) > 2) {
        logActivity.info(`🛢️ Oil ${oil.changePercent > 0 ? 'up' : 'down'} ${Math.abs(oil.changePercent).toFixed(1)}% - may impact energy sector`);
      }
    } catch (e) {
      // World Monitor data is optional enhancement
    }

    // Always call AI analysis with full context
    aiAnalysis = await this.getAISentimentAnalysis(pair, news, marketData, technicalsForAI, worldContext);
    if (aiAnalysis) {
      logActivity.info(`🤖 AI Sentiment for ${pair}: ${aiAnalysis.sentiment} | Signal: ${aiAnalysis.signal} | Confidence: ${aiAnalysis.confidence}%`);
    }

    // Calculate enhanced indicators (Stoch RSI, ATR, OBV, Ichimoku)
    const enhanced = calculateEnhancedIndicators(priceData);
    logActivity.calculating(`${pair}: StochRSI K=${enhanced.stochRSI.k.toFixed(1)} D=${enhanced.stochRSI.d.toFixed(1)} (${enhanced.stochRSI.signal}) | ATR=${enhanced.atrPercent.toFixed(2)}% | OBV=${enhanced.obv.trend} | Ichimoku=${enhanced.ichimoku.signal} | Volatility=${enhanced.volatilityLevel}`);

    // ── Intelligence Steps 1-4: Sentiment, VIX, SPY Trend, Earnings ─────────
    let marketSentiment: SentimentSummary | null = null;
    try {
      marketSentiment = await getMarketSentiment(pair);
      const { fearGreed, vix, spyTrend, earnings } = marketSentiment;
      logActivity.info(`😱 Fear&Greed: ${fearGreed.value} (${fearGreed.classification}) | VIX: ${vix.value.toFixed(1)} ${vix.level} | SPY: ${spyTrend.trend} | Earnings: ${earnings.riskLevel}`);
      logActivity.info(`📊 Market bias: ${marketSentiment.overallSentiment} (score: ${marketSentiment.overallScore.toFixed(0)}) | Size mult: ${vix.positionSizeMultiplier}x`);

      // Hard blocks — override everything
      if (!vix.tradingAllowed) {
        logActivity.warning(`🚫 ${pair}: VIX ${vix.value.toFixed(1)} too high — trading blocked`);
        return { pair, action: 'hold', confidence: 0, entryPrice: currentPrice, stopLoss: currentPrice, takeProfit: currentPrice, positionSize: 0, reasoning: vix.interpretation, technicalSignals, timestamp: Date.now() };
      }
      if (!earnings.tradingAllowed) {
        logActivity.warning(`🚫 ${pair}: ${earnings.interpretation}`);
        return { pair, action: 'hold', confidence: 0, entryPrice: currentPrice, stopLoss: currentPrice, takeProfit: currentPrice, positionSize: 0, reasoning: earnings.interpretation, technicalSignals, timestamp: Date.now() };
      }
      // SPY downtrend: block new BUY signals — only allow sells/holds
      if (spyTrend.trend === 'downtrend') {
        logActivity.warning(`⚠️ ${pair}: SPY in downtrend — suppressing BUY signals`);
      }
    } catch (err) {
      logActivity.warning(`Market intelligence unavailable for ${pair} — using technicals only`);
    }

    // ── Determine action: technicals + AI + market intelligence ──────────────
    let action: 'buy' | 'sell' | 'hold' = 'hold';
    let confidence = technicalSignals.confidence;

    if (aiAnalysis) {
      const technicalWeight = 0.6;
      const aiWeight = 0.4;
      let aiScore = 50;
      if (aiAnalysis.signal === 'BUY') aiScore = aiAnalysis.confidence;
      else if (aiAnalysis.signal === 'SELL') aiScore = 100 - aiAnalysis.confidence;

      confidence = Math.round((technicalSignals.confidence * technicalWeight) + (aiScore * aiWeight));

      if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') {
        if (aiAnalysis.signal === 'BUY') { action = 'buy'; confidence = Math.min(confidence + 10, 100); }
        else if (aiAnalysis.signal === 'SELL') { action = 'hold'; confidence = 50; }
        else { action = 'buy'; }
      } else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') {
        if (aiAnalysis.signal === 'SELL') { action = 'sell'; confidence = Math.min(confidence + 10, 100); }
        else if (aiAnalysis.signal === 'BUY') { action = 'hold'; confidence = 50; }
        else { action = 'sell'; }
      } else {
        if (aiAnalysis.signal === 'BUY' && aiAnalysis.confidence >= 70) action = 'buy';
        else if (aiAnalysis.signal === 'SELL' && aiAnalysis.confidence >= 70) action = 'sell';
      }
    } else {
      if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') action = 'buy';
      else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') action = 'sell';
    }

    // Apply SPY downtrend filter — suppress BUY signals when market is falling
    if (action === 'buy' && marketSentiment?.spyTrend.trend === 'downtrend') {
      logActivity.warning(`${pair}: BUY suppressed — SPY downtrend. Switching to HOLD.`);
      action = 'hold';
      confidence = Math.min(confidence, 40);
    }

    // Apply sentiment penalty — reduce confidence when market is bearish
    if (marketSentiment && marketSentiment.overallSentiment === 'Bearish') {
      if (action === 'buy') confidence = Math.max(0, confidence - 15);
    }

    // ── Step 5: Fee-aware position sizing via ATR ─────────────────────────────
    let availableCash = 10000;
    try {
      const balance = await ib.getBalance();
      const cashKey = Object.keys(balance).find(k => k.startsWith('AvailableFunds_'));
      if (cashKey) availableCash = parseFloat(balance[cashKey]);
    } catch { /* use fallback */ }

    const vixMultiplier = marketSentiment?.vix.positionSizeMultiplier ?? 1.0;
    const earningsRisk = marketSentiment?.earnings.riskLevel ?? 'safe';
    const sizing = calculatePositionSize(pair, currentPrice, enhanced.atr, availableCash, vixMultiplier, earningsRisk);

    logActivity.info(`💰 ${sizing.interpretation}`);

    // Block trade if fees eat profit
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

    // Use ATR-based stops instead of fixed percentages
    const stopLoss = action === 'buy'
      ? sizing.stopLossPrice
      : currentPrice * (1 + this.config.stopLossPercent);
    const takeProfit = action === 'buy'
      ? sizing.takeProfitPrice
      : currentPrice * (1 - this.config.takeProfitPercent);

    const reasoning = this.generateReasoning(technicalSignals, aiAnalysis);

    return {
      pair,
      action,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      positionSize,
      reasoning,
      technicalSignals,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset daily trade counter if it's a new day
   */
  private resetDailyTradeCountIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
      logActivity.info(`📅 New trading day started. Daily trade count reset.`);
    }
  }

  /**
   * Check if trade is allowed based on cooldown, daily limits, and profit margin
   */
  private isTradeAllowed(signal: TradeSignal): {
    allowed: boolean;
    reason?: string;
    expectedProfitPercent?: number;
  } {
    // Check daily trade limit
    if (this.dailyTradeCount >= this.config.maxDailyTrades) {
      return {
        allowed: false,
        reason: `Daily trade limit reached (${this.config.maxDailyTrades} trades/day)`,
      };
    }

    // Check cooldown period for this pair
    const lastTrade = this.lastTradeTime.get(signal.pair);
    if (lastTrade) {
      const hoursSinceLastTrade = (Date.now() - lastTrade) / (1000 * 60 * 60);
      if (hoursSinceLastTrade < this.config.tradeCooldownHours) {
        const hoursRemaining = (this.config.tradeCooldownHours - hoursSinceLastTrade).toFixed(1);
        return {
          allowed: false,
          reason: `Cooldown active. Wait ${hoursRemaining} more hours before trading ${signal.pair}`,
        };
      }
    }

    // Calculate expected profit after fees
    const roundTripFee = this.config.tradingFeePercent * 2; // Buy + Sell
    const expectedMove = signal.action === 'buy'
      ? ((signal.takeProfit - signal.entryPrice) / signal.entryPrice)
      : ((signal.entryPrice - signal.takeProfit) / signal.entryPrice);
    
    const expectedProfitPercent = (expectedMove - roundTripFee) * 100;

    // Check if expected profit meets minimum margin
    if (expectedProfitPercent < this.config.minProfitMargin * 100) {
      return {
        allowed: false,
        reason: `Expected profit ${expectedProfitPercent.toFixed(2)}% below minimum ${(this.config.minProfitMargin * 100).toFixed(2)}% (after ${(roundTripFee * 100).toFixed(2)}% fees)`,
        expectedProfitPercent,
      };
    }

    return {
      allowed: true,
      expectedProfitPercent,
    };
  }

  /**
   * Execute a trading signal
   */
  private async executeSignal(signal: TradeSignal): Promise<void> {
    try {
      console.log(`\n⚡ Executing ${signal.action.toUpperCase()} order for ${signal.pair}...`);
      logActivity.executing(`Executing ${signal.action.toUpperCase()} order for ${signal.pair}...`);

      const ib = createIBClient();

      if (signal.action === 'hold') return;

      // For SELL: verify we actually hold shares via IB positions
      if (signal.action === 'sell') {
        const positions = await ib.getPositions();
        const pos = positions.find(p => p.symbol === signal.pair && p.position > 0);
        if (!pos) {
          logActivity.warning(`Cannot sell ${signal.pair}: No IB position found`);
          return;
        }
        // Sell only what we own
        signal.positionSize = Math.min(signal.positionSize, pos.position);
        logActivity.info(`✅ IB position found: ${pos.position} shares of ${signal.pair}`);
      }

      // Place order via IB (validate_only=true in paper mode, false when live)
      const result = await ib.placeOrder({
        symbol:        signal.pair,
        action:        signal.action === 'buy' ? 'BUY' : 'SELL',
        quantity:      signal.positionSize,
        order_type:    'MKT',
        validate_only: !this.config.autoExecute,
      });

      if (this.config.autoExecute && result.order_id) {
        logActivity.completed(`✅ ${signal.action.toUpperCase()} ${signal.positionSize} ${signal.pair} at $${signal.entryPrice.toFixed(2)} | OrderID: ${result.order_id}`);
        logActivity.info(`🛡️ Stop-loss: $${signal.stopLoss.toFixed(2)} | 🎯 Take-profit: $${signal.takeProfit.toFixed(2)}`);
        this.lastTradeTime.set(signal.pair, Date.now());
        this.dailyTradeCount++;
        logActivity.info(`📊 Daily trades: ${this.dailyTradeCount}/${this.config.maxDailyTrades}`);
      } else {
        logActivity.completed(`✅ Order validated (paper mode) — would ${signal.action.toUpperCase()} ${signal.positionSize} shares of ${signal.pair} at $${signal.entryPrice.toFixed(2)}`);
        if (result.commission) logActivity.info(`💰 Estimated commission: $${result.commission}`);
      }

      // Track position locally
      const posId = result.order_id?.toString() ?? `${signal.pair}-${Date.now()}`;
      this.activePositions.set(posId, {
        txid:         posId,
        pair:         signal.pair,
        type:         signal.action,
        entryPrice:   signal.entryPrice,
        volume:       signal.positionSize,
        stopLoss:     signal.stopLoss,
        takeProfit:   signal.takeProfit,
        currentPrice: signal.entryPrice,
        pnl:          0,
        pnlPercent:   0,
        timestamp:    signal.timestamp,
      });
    } catch (error: any) {
      console.error(`❌ Failed to execute order:`, error.message);
      logActivity.error(`Failed to execute ${signal.action} order for ${signal.pair}: ${error.message}`);
    }
  }

  /**
   * Update active positions and check for stop-loss/take-profit
   */
  private async updatePositions(): Promise<void> {
    if (this.activePositions.size === 0) return;

    try {
      const ib = createIBClient();

      for (const [txid, position] of this.activePositions) {
        // Get current price via IB
        const ticker = await ib.getTicker(position.pair);
        const currentPrice = ticker.last ?? ticker.close ?? position.currentPrice;

        // Update position
        position.currentPrice = currentPrice;
        
        if (position.type === 'buy') {
          position.pnl = (currentPrice - position.entryPrice) * position.volume;
          position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
          position.pnl = (position.entryPrice - currentPrice) * position.volume;
          position.pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        }

        // Check stop-loss and take-profit
        const shouldClose = this.riskManager.shouldClosePosition({
          pair: position.pair,
          type: position.type,
          entryPrice: position.entryPrice,
          volume: position.volume,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          currentPrice: position.currentPrice,
        });

        if (shouldClose.shouldClose) {
          console.log(`\n🔔 ${shouldClose.reason?.toUpperCase()} triggered for ${position.pair}`);
          console.log(`   Entry: $${position.entryPrice.toFixed(2)}`);
          console.log(`   Current: $${currentPrice.toFixed(2)}`);
          console.log(`   P&L: $${position.pnl.toFixed(2)} (${position.pnlPercent.toFixed(2)}%)`);

          if (this.config.autoExecute) {
            // Close position
            await this.closePosition(txid);
          }
        }
      }
    } catch (error) {
      console.error('Error updating positions:', error);
    }
  }

  /**
   * Close a position
   */
  private async closePosition(txid: string): Promise<void> {
    const position = this.activePositions.get(txid);
    if (!position) return;

    try {
      const ib = createIBClient();

      // Place opposite order to close position
      const closeAction = position.type === 'buy' ? 'SELL' : 'BUY';
      await ib.placeOrder({
        symbol:        position.pair,
        action:        closeAction,
        quantity:      position.volume,
        order_type:    'MKT',
        validate_only: false, // always execute closes
      });

      console.log(`✅ Position closed successfully`);
      console.log(`   Final P&L: $${position.pnl.toFixed(2)} (${position.pnlPercent.toFixed(2)}%)`);

      // Remove from active positions
      this.activePositions.delete(txid);
    } catch (error: any) {
      console.error(`❌ Failed to close position:`, error.message);
    }
  }

  /**
   * Generate reasoning text from technical signals and AI analysis
   */
  private generateReasoning(signals: TechnicalSignals, aiAnalysis?: any): string {
    const reasons: string[] = [];

    // Technical analysis reasons
    if (signals.rsiSignal === 'oversold') {
      reasons.push(`RSI at ${signals.rsi.toFixed(1)} indicates oversold conditions`);
    } else if (signals.rsiSignal === 'overbought') {
      reasons.push(`RSI at ${signals.rsi.toFixed(1)} indicates overbought conditions`);
    }

    if (signals.macd.trend === 'bullish') {
      reasons.push('MACD showing bullish momentum');
    } else if (signals.macd.trend === 'bearish') {
      reasons.push('MACD showing bearish momentum');
    }

    if (signals.bollingerBands.position === 'below') {
      reasons.push('Price below lower Bollinger Band (potential bounce)');
    } else if (signals.bollingerBands.position === 'above') {
      reasons.push('Price above upper Bollinger Band (potential reversal)');
    }

    if (signals.volume.spike) {
      reasons.push('Unusual volume spike detected');
    }

    // Add AI sentiment analysis if available
    if (aiAnalysis) {
      reasons.push(`AI Sentiment: ${aiAnalysis.sentiment} (${aiAnalysis.confidence}% confidence)`);
      
      if (aiAnalysis.keyFactors && aiAnalysis.keyFactors.length > 0) {
        reasons.push(`Key factors: ${aiAnalysis.keyFactors.slice(0, 2).join(', ')}`);
      }
      
      if (aiAnalysis.recommendation) {
        const shortRec = aiAnalysis.recommendation.substring(0, 100);
        reasons.push(`AI: ${shortRec}${aiAnalysis.recommendation.length > 100 ? '...' : ''}`);
      }
    }

    return reasons.join('. ') || 'Technical indicators aligned';
  }

  /**
   * Get active positions
   */
  getActivePositions(): ActivePosition[] {
    return Array.from(this.activePositions.values());
  }

  /**
   * Get engine status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      activePositions: this.getActivePositions().length,
    };
  }

  /**
   * Save portfolio snapshot
   */
  private async savePortfolioSnapshot(): Promise<void> {
    try {
      await fetch('http://localhost:3001/api/portfolio/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (error) {
      // Silently fail - portfolio tracking is optional
      console.debug('Portfolio snapshot skipped:', error);
    }
  }
}

/**
 * Create a trading engine instance
 */
export function createTradingEngine(config?: Partial<TradingEngineConfig>): TradingEngine {
  return new TradingEngine(config);
}
