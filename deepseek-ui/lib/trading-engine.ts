/**
 * Automated Trading Engine
 * Monitors markets, generates signals, and executes trades automatically
 */

import { createKrakenClient } from './kraken';
import { analyzeTechnicalIndicators, getHistoricalPrices, TechnicalSignals } from './technical-indicators';
import { createRiskManager, RiskManager } from './risk-management';
import { logActivity } from './activity-logger';

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
}

export class TradingEngine {
  private config: TradingEngineConfig;
  private riskManager: RiskManager;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;
  private activePositions: Map<string, ActivePosition> = new Map();

  constructor(config: Partial<TradingEngineConfig> = {}) {
    this.config = {
      pairs: config.pairs || ['XXBTZUSD', 'XETHZUSD', 'XLTCZUSD', 'XXRPZUSD'],
      checkInterval: config.checkInterval || 5 * 60 * 1000, // 5 minutes
      minConfidence: config.minConfidence || 75,
      maxPositions: config.maxPositions || 3,
      riskPerTrade: config.riskPerTrade || 0.25, // 25% of capital per trade
      stopLossPercent: config.stopLossPercent || 0.08, // 8% stop loss
      takeProfitPercent: config.takeProfitPercent || 0.30, // 30% take profit (targeting 25% avg)
      autoExecute: config.autoExecute || false,
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
      // Update active positions
      await this.updatePositions();

      // Check each trading pair
      for (const pair of this.config.pairs) {
        try {
          logActivity.analyzing(`Analyzing ${pair}...`);
          const signal = await this.generateSignal(pair);
          
          // Log the signal details
          logActivity.calculating(`${pair}: RSI ${signal.technicalSignals.rsi.toFixed(1)}, MACD ${signal.technicalSignals.macd.trend}, Confidence ${signal.confidence}%`);
          
          if (signal.action !== 'hold' && signal.confidence >= this.config.minConfidence) {
            console.log(`\n🎯 Signal generated for ${pair}:`);
            console.log(`   Action: ${signal.action.toUpperCase()}`);
            console.log(`   Confidence: ${signal.confidence}%`);
            console.log(`   Entry: $${signal.entryPrice.toFixed(2)}`);
            console.log(`   Stop Loss: $${signal.stopLoss.toFixed(2)}`);
            console.log(`   Take Profit: $${signal.takeProfit.toFixed(2)}`);
            console.log(`   Position Size: ${signal.positionSize.toFixed(8)}`);
            console.log(`   Reasoning: ${signal.reasoning}`);

            logActivity.info(`🎯 Signal: ${signal.action.toUpperCase()} ${pair} | Confidence: ${signal.confidence}% | Entry: $${signal.entryPrice.toFixed(2)}`);
            logActivity.info(`📊 ${signal.reasoning}`);

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
   * Get AI sentiment analysis
   */
  private async getAISentimentAnalysis(pair: string, news: any[], marketData: any): Promise<any> {
    try {
      const response = await fetch('http://localhost:3001/api/trading/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair,
          news: news.slice(0, 10), // Top 10 news items
          marketData,
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
    // Get historical price data
    const priceData = await getHistoricalPrices(pair, 5); // 5-minute candles
    
    if (priceData.length < 50) {
      throw new Error(`Insufficient price data for ${pair}`);
    }

    // Analyze technical indicators
    const technicalSignals = analyzeTechnicalIndicators(priceData);
    const currentPrice = priceData[priceData.length - 1].close;

    // Fetch World Monitor news for fundamental analysis
    const news = await this.fetchWorldMonitorNews();
    
    // Get current market data for AI analysis
    const kraken = createKrakenClient();
    const ticker = await kraken.getTicker(this.config.pairs);
    const marketData: any = {};
    for (const p of this.config.pairs) {
      if (ticker[p]) {
        marketData[p] = {
          price: ticker[p].c[0],
          volume: ticker[p].v[1],
          change24h: ticker[p].p ? ticker[p].p[1] : '0',
        };
      }
    }

    // Get AI sentiment analysis if news is available
    let aiAnalysis = null;
    if (news.length > 0) {
      aiAnalysis = await this.getAISentimentAnalysis(pair, news, marketData);
      
      if (aiAnalysis) {
        logActivity.info(`🤖 AI Sentiment for ${pair}: ${aiAnalysis.sentiment} | Signal: ${aiAnalysis.signal} | Confidence: ${aiAnalysis.confidence}%`);
      }
    }

    // Determine action based on BOTH technical signals AND AI sentiment
    let action: 'buy' | 'sell' | 'hold' = 'hold';
    let confidence = technicalSignals.confidence;

    // Combine technical and fundamental analysis
    if (aiAnalysis) {
      // Weight: 60% technical, 40% AI sentiment
      const technicalWeight = 0.6;
      const aiWeight = 0.4;
      
      // Convert AI signal to numeric score
      let aiScore = 50; // neutral
      if (aiAnalysis.signal === 'BUY') {
        aiScore = aiAnalysis.confidence;
      } else if (aiAnalysis.signal === 'SELL') {
        aiScore = 100 - aiAnalysis.confidence;
      }
      
      // Combine scores
      const combinedConfidence = (technicalSignals.confidence * technicalWeight) + (aiScore * aiWeight);
      confidence = Math.round(combinedConfidence);
      
      // Determine action based on combined analysis
      if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') {
        if (aiAnalysis.signal === 'BUY') {
          action = 'buy';
          confidence = Math.min(confidence + 10, 100); // Boost confidence when both agree
        } else if (aiAnalysis.signal === 'SELL') {
          action = 'hold'; // Conflicting signals = hold
          confidence = 50;
        } else {
          action = 'buy';
        }
      } else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') {
        if (aiAnalysis.signal === 'SELL') {
          action = 'sell';
          confidence = Math.min(confidence + 10, 100); // Boost confidence when both agree
        } else if (aiAnalysis.signal === 'BUY') {
          action = 'hold'; // Conflicting signals = hold
          confidence = 50;
        } else {
          action = 'sell';
        }
      } else {
        // Technical is neutral, follow AI if strong signal
        if (aiAnalysis.signal === 'BUY' && aiAnalysis.confidence >= 70) {
          action = 'buy';
        } else if (aiAnalysis.signal === 'SELL' && aiAnalysis.confidence >= 70) {
          action = 'sell';
        }
      }
    } else {
      // No AI analysis available, use technical only
      if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') {
        action = 'buy';
      } else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') {
        action = 'sell';
      }
    }

    // Calculate stop loss and take profit
    const stopLoss = action === 'buy'
      ? currentPrice * (1 - this.config.stopLossPercent)
      : currentPrice * (1 + this.config.stopLossPercent);

    const takeProfit = action === 'buy'
      ? currentPrice * (1 + this.config.takeProfitPercent)
      : currentPrice * (1 - this.config.takeProfitPercent);

    // Calculate position size based on pair and available balance
    // Kraken minimum order sizes (CAD pairs):
    const minimumSizes: { [key: string]: number } = {
      // Major Cryptos (CAD pairs)
      'XXBTZCAD': 0.0001, 'XETHZCAD': 0.001, 'XLTCZCAD': 0.01, 'XXRPZCAD': 10,
      'ADACAD': 10, 'SOLCAD': 0.1, 'DOTCAD': 1, 'LINKCAD': 0.5,
      'MATICCAD': 10, 'AVAXCAD': 0.5, 'ATOMCAD': 1, 'ALGOCAD': 10,
      'UNICAD': 0.5, 'XLMCAD': 30, 'XMRCAD': 0.1, 'ETCCAD': 1,
      'BCHCAD': 0.01, 'TRXCAD': 100, 'EOSCAD': 10, 'AAVECAD': 0.1,
      
      // More Cryptos (CAD pairs)
      'DOGECAD': 100, 'APTCAD': 1, 'ARBCAD': 10, 'OPCAD': 5,
      'NEARCAD': 5, 'FTMCAD': 20, 'CHZCAD': 50, 'ENJCAD': 20,
      'COMPCAD': 0.05, 'MKRCAD': 0.01, 'SNXCAD': 5, 'CRVCAD': 20,
      'SUSHICAD': 10, 'LRCCAD': 50, 'GRTCAD': 50, 'INJCAD': 1,
    };

    // With $50 CAD, calculate affordable position size
    const availableCAD = 50; // $50 CAD balance
    const positionValue = availableCAD * this.config.riskPerTrade; // 20% = $10
    let positionSize = positionValue / currentPrice;
    
    // Ensure we meet minimum order size
    const minSize = minimumSizes[pair] || 0.001;
    positionSize = Math.max(positionSize, minSize);
    
    // Check if we can afford this position
    const orderValue = positionSize * currentPrice;
    if (orderValue > availableCAD * 0.9) { // Use max 90% of balance for safety
      // Scale down to affordable size
      positionSize = (availableCAD * 0.9) / currentPrice;
      
      // If still below minimum, skip this pair
      if (positionSize < minSize) {
        logActivity.warning(`${pair}: Position size ${positionSize.toFixed(8)} below minimum ${minSize}. Skipping.`);
        action = 'hold';
        confidence = 0;
      }
    }

    // Generate reasoning including AI analysis
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
   * Execute a trading signal
   */
  private async executeSignal(signal: TradeSignal): Promise<void> {
    try {
      console.log(`\n⚡ Executing ${signal.action.toUpperCase()} order for ${signal.pair}...`);
      logActivity.executing(`Executing ${signal.action.toUpperCase()} order for ${signal.pair}...`);

      const kraken = createKrakenClient();
      
      // Only execute if action is buy or sell (not hold)
      if (signal.action === 'hold') {
        console.log('Signal is HOLD, skipping execution');
        return;
      }

      // Check balance before executing
      if (signal.action === 'sell') {
        // Get current balance
        const balance = await kraken.getBalance();
        
        // Extract the asset from the pair (e.g., XXRPZCAD -> XXRP, XXBTZCAD -> XXBT)
        const asset = signal.pair.replace('CAD', '').replace('ZCAD', '');
        
        // Check if we own this asset
        const assetBalance = parseFloat(balance[asset] || '0');
        
        if (assetBalance < signal.positionSize) {
          console.log(`❌ Cannot sell ${signal.pair}: Insufficient balance`);
          console.log(`   Required: ${signal.positionSize}, Available: ${assetBalance}`);
          logActivity.warning(`Cannot sell ${signal.pair}: Don't own enough (need ${signal.positionSize}, have ${assetBalance})`);
          return;
        }
        
        logActivity.info(`✅ Balance check passed: ${assetBalance} ${asset} available`);
      }

      // Place order
      const result = await kraken.addOrder({
        pair: signal.pair,
        type: signal.action,
        ordertype: 'market',
        volume: signal.positionSize.toString(),
        validate: !this.config.autoExecute, // Validate only if not auto-executing
      });

      console.log(`✅ Order placed successfully!`);
      console.log(`   Transaction ID: ${result.txid.join(', ')}`);

      if (this.config.autoExecute) {
        logActivity.completed(`✅ ${signal.action.toUpperCase()} ${signal.positionSize} ${signal.pair} at $${signal.entryPrice.toFixed(2)} | TXID: ${result.txid.join(', ')}`);
        logActivity.info(`🛡️ Stop-loss: $${signal.stopLoss.toFixed(2)} | 🎯 Take-profit: $${signal.takeProfit.toFixed(2)}`);
      } else {
        logActivity.completed(`✅ Order validated successfully (test mode)`);
      }

      // Track position
      if (result.txid && result.txid.length > 0) {
        this.activePositions.set(result.txid[0], {
          txid: result.txid[0],
          pair: signal.pair,
          type: signal.action,
          entryPrice: signal.entryPrice,
          volume: signal.positionSize,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          currentPrice: signal.entryPrice,
          pnl: 0,
          pnlPercent: 0,
          timestamp: signal.timestamp,
        });
      }
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
      const kraken = createKrakenClient();
      
      for (const [txid, position] of this.activePositions) {
        // Get current price
        const ticker = await kraken.getTicker([position.pair]);
        const currentPrice = parseFloat(ticker[position.pair].c[0]);

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
      const kraken = createKrakenClient();
      
      // Place opposite order to close position
      const closeType = position.type === 'buy' ? 'sell' : 'buy';
      await kraken.addOrder({
        pair: position.pair,
        type: closeType,
        ordertype: 'market',
        volume: position.volume.toString(),
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
}

/**
 * Create a trading engine instance
 */
export function createTradingEngine(config?: Partial<TradingEngineConfig>): TradingEngine {
  return new TradingEngine(config);
}
