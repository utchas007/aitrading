/**
 * Automated Trading Engine
 * Monitors markets, generates signals, and executes trades automatically
 */

import { createIBClient } from './ib-client';
import { analyzeTechnicalIndicators, getHistoricalPrices, TechnicalSignals } from './technical-indicators';
import { createRiskManager, RiskManager } from './risk-management';
import { logActivity } from './activity-logger';
import { createLogger } from './logger';

const log = createLogger('trading-engine');
import {
  getMarketSentiment, calculateEnhancedIndicators, calculatePositionSize,
  SentimentSummary,
} from './market-intelligence';
import {
  getWorldMonitorSummary, getMarketContextForAI,
} from './worldmonitor-data';
import { getMarketSession, isNoisyTradingPeriod } from './market-hours';
import { saveNotification } from './notify';
import { checkBalanceDrop, alertIBDisconnected } from './alerting';
import {
  DEFAULT_MIN_CONFIDENCE, DEFAULT_MAX_POSITIONS, DEFAULT_RISK_PER_TRADE,
  DEFAULT_STOP_LOSS_PERCENT, DEFAULT_TAKE_PROFIT_PERCENT, DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_MAX_DAILY_TRADES, DEFAULT_TRADE_COOLDOWN_HOURS,
  DEFAULT_PARTIAL_PROFIT_PERCENT, DEFAULT_TRAILING_ACTIVATION_PERCENT, DEFAULT_TRAILING_STOP_PERCENT,
  DEFAULT_MAX_DAILY_LOSS_PERCENT, DEFAULT_MAX_POSITIONS_PER_SECTOR, DEFAULT_MAX_HOLD_DAYS,
  ENTRY_LIMIT_SLIPPAGE, TECHNICAL_WEIGHT, AI_WEIGHT, AI_ONLY_MIN_CONFIDENCE,
  AGREEMENT_CONFIDENCE_BOOST, VOLUME_CONFIRMATION_RATIO, BB_BELOW_RSI_MAX,
  BB_ABOVE_RSI_MIN, ELEVATED_VIX_MACD_THRESHOLD, BEARISH_SENTIMENT_CONFIDENCE_PENALTY,
  MAX_IB_FAILURE_COUNT, SECTOR_MAP, RATCHET_MIN_INTERVAL_MS,
} from './constants';

// Async DB write — persist OHLCV candles, fire and forget, never blocks the bot
async function savePriceCandles(pair: string, interval: number, priceData: import('./technical-indicators').PriceData[]): Promise<void> {
  if (!priceData.length) return;
  try {
    const { prisma } = await import('./db');
    await Promise.all(
      priceData.map(bar =>
        prisma.priceCandle.upsert({
          where: { pair_interval_time: { pair, interval, time: Math.floor(bar.timestamp / 1000) } },
          update: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
          create: { pair, interval, time: Math.floor(bar.timestamp / 1000), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
        })
      )
    );
  } catch (e: any) {
    // Classify error so it's actionable in logs — connection issues are transient,
    // constraint/schema errors need investigation.
    const isConnection = e?.code === 'P1001' || e?.message?.includes('connect');
    const isConstraint = e?.code?.startsWith('P2');
    const kind = isConnection ? 'DB_CONNECTION' : isConstraint ? 'DB_CONSTRAINT' : 'DB_ERROR';
    log.error(`${kind} in savePriceCandles`, { pair, interval, bars: priceData.length, error: e?.message ?? String(e) });
  }
}

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
  } catch (e: any) {
    const isConnection = e?.code === 'P1001' || e?.message?.includes('connect');
    const isConstraint = e?.code?.startsWith('P2');
    const kind = isConnection ? 'DB_CONNECTION' : isConstraint ? 'DB_CONSTRAINT' : 'DB_ERROR';
    log.error(`${kind} in saveSignalToDb`, { pair: signal.pair, action: signal.action, confidence: signal.confidence, error: e?.message ?? String(e) });
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
  marketSentiment?: SentimentSummary | null;
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
  dbTradeId?: number;         // DB Trade.id for updating on close
  // Native IB bracket order IDs — set when autoExecute=true
  parentOrderId?: number;     // Entry market order
  slOrderId?: number;         // Stop-loss child order
  tpOrderId?: number;         // Take-profit child order
  // Profit/loss targets in dollar terms — always known, survives restarts
  expectedProfitUSD?: number; // Dollar gain if take-profit fires
  expectedLossUSD?: number;   // Dollar loss if stop-loss fires
  riskRewardRatio?: number;   // expectedProfitUSD / expectedLossUSD
  // High/low water marks for trailing stop — tracked in memory, reset on restart
  highestPrice?: number;      // Highest price reached — BUY trailing stop
  lowestPrice?: number;       // Lowest price reached  — SELL trailing stop
  // Partial profit tracking
  partialTaken?: boolean;     // True once 50% has been sold at the partial target
  partialPnl?: number;        // Realized P&L from the partial exit
  // Ratchet cooldown — prevents duplicate OCA orders from rapid consecutive ratchets
  lastRatchetAt?: number;     // Timestamp of last successful trailing-stop ratchet
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
  partialProfitPercent: number; // Profit % to sell half the position (e.g. 0.05 = 5%)
  trailingActivationPercent: number; // Profit % to activate trailing stop (e.g. 0.07 = 7%)
  trailingStopPercent: number; // Trail distance below highest price (e.g. 0.03 = 3%)
  maxDailyLossPercent: number; // Stop new trades if today's realized P&L < -(this × account value)
  maxPositionsPerSector: number; // Max concurrent open positions in same sector
}

export class TradingEngine {
  private config: TradingEngineConfig;
  private riskManager: RiskManager;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;
  private positionIntervalId?: NodeJS.Timeout; // Fast loop: SL/TP monitoring every 30s
  private ibFailureCount: number = 0;          // Consecutive IB health check failures
  private readonly MAX_IB_FAILURES = MAX_IB_FAILURE_COUNT;
  private ibWaitingReconnect: boolean = false;  // Paused waiting for IB to come back
  private priceLastSeenAt: Map<string, number> = new Map(); // Last time each symbol had price > 0
  private dynamicPairs: Map<string, number> = new Map();    // AI-suggested symbols → addedAt ms
  private lastWatchlistSuggestAt: number = 0;               // Rate-limit: once every 6h
  private activePositions: Map<string, ActivePosition> = new Map();
  private lastTradeTime: Map<string, number> = new Map(); // Track last trade time per pair
  private dailyTradeCount: number = 0;
  private dailyRealizedPnl: number = 0;   // Cumulative realized P&L today (USD)
  private dailyAccountValue: number = 100_000; // Latest net liquidation — updated each cycle
  private lastResetDate: string = new Date().toDateString();
  private preOpenPrepDone: string = ''; // Date string of last pre-open prep (once per day)
  private lastHeartbeatAt: number = 0;   // Timestamp of last successful cycle
  private heartbeatIntervalId?: NodeJS.Timeout; // Heartbeat monitor timer

  constructor(config: Partial<TradingEngineConfig> = {}) {
    this.config = {
      pairs: config.pairs || [
        // Mega-cap tech
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META',
        // Semiconductors
        'NVDA', 'AMD', 'QCOM', 'AVGO',
        // Growth tech
        'TSLA', 'PLTR', 'CRM', 'NFLX', 'ORCL', 'ADBE',
        // Financials
        'JPM', 'V', 'GS',
        // Healthcare
        'LLY', 'UNH',
        // Energy
        'XOM',
        // Consumer
        'COST',
        // Industrial
        'CAT',
        // ETFs
        'IWM',
      ],
      checkInterval:     config.checkInterval     || DEFAULT_CHECK_INTERVAL_MS,
      minConfidence:     config.minConfidence     || DEFAULT_MIN_CONFIDENCE,
      maxPositions:      config.maxPositions      || DEFAULT_MAX_POSITIONS,
      riskPerTrade:      config.riskPerTrade      || DEFAULT_RISK_PER_TRADE,
      stopLossPercent:   config.stopLossPercent   || DEFAULT_STOP_LOSS_PERCENT,
      takeProfitPercent: config.takeProfitPercent || DEFAULT_TAKE_PROFIT_PERCENT,
      autoExecute:       config.autoExecute       || false,
      tradingFeePercent: config.tradingFeePercent || 0.0005, // IB ~$0.005/share ≈ 0.05% round-trip
      minProfitMargin:   config.minProfitMargin   || 0.02,   // 2% minimum profit above fees
      tradeCooldownHours:           config.tradeCooldownHours           || DEFAULT_TRADE_COOLDOWN_HOURS,
      maxDailyTrades:               config.maxDailyTrades               || DEFAULT_MAX_DAILY_TRADES,
      partialProfitPercent:         config.partialProfitPercent         ?? DEFAULT_PARTIAL_PROFIT_PERCENT,
      trailingActivationPercent:    config.trailingActivationPercent    ?? DEFAULT_TRAILING_ACTIVATION_PERCENT,
      trailingStopPercent:          config.trailingStopPercent          ?? DEFAULT_TRAILING_STOP_PERCENT,
      maxDailyLossPercent:          config.maxDailyLossPercent          ?? DEFAULT_MAX_DAILY_LOSS_PERCENT,
      maxPositionsPerSector:        config.maxPositionsPerSector        ?? DEFAULT_MAX_POSITIONS_PER_SECTOR,
    };

    this.riskManager = createRiskManager({
      maxPositionSize:           this.config.riskPerTrade,
      stopLossPercent:           this.config.stopLossPercent,
      takeProfitPercent:         this.config.takeProfitPercent,
      maxOpenPositions:          this.config.maxPositions,
      minConfidence:             this.config.minConfidence,
      trailingActivationPercent: this.config.trailingActivationPercent,
      trailingStopPercent:       this.config.trailingStopPercent,
    });
  }

  /**
   * Start the trading engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.info('Trading engine is already running');
      return;
    }

    log.info('Starting trading engine', {
      pairs: this.config.pairs.join(', '),
      checkIntervalSec: this.config.checkInterval / 1000,
      minConfidence: this.config.minConfidence,
      autoExecute: this.config.autoExecute,
    });

    this.isRunning = true;
    this.lastHeartbeatAt = Date.now();

    // Recover any open positions from DB before starting the loops
    // (handles restarts where activePositions Map was lost)
    await this.recoverPositions();

    // Heartbeat monitor: warn if the engine hasn't completed a cycle in 2× the check interval
    this.heartbeatIntervalId = setInterval(() => {
      const silentMs = Date.now() - this.lastHeartbeatAt;
      const thresholdMs = this.config.checkInterval * 2;
      if (this.isRunning && silentMs > thresholdMs) {
        log.warn('Engine heartbeat missed — no cycle completed in expected window', {
          silentMs: Math.round(silentMs / 1000) + 's',
          thresholdSec: Math.round(thresholdMs / 1000),
        });
      }
    }, this.config.checkInterval);

    // Fast loop: check SL/TP / detect IB-native closes every 30s
    this.positionIntervalId = setInterval(() => {
      this.updatePositions();
    }, 30_000);

    // Run initial market check, then repeat at checkInterval
    await this.checkMarkets();
    this.intervalId = setInterval(() => {
      this.checkMarkets();
    }, this.config.checkInterval);
  }

  /**
   * Stop the trading engine
   */
  stop(): void {
    if (!this.isRunning) {
      log.info('Trading engine is not running');
      return;
    }

    log.info('Stopping trading engine');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.positionIntervalId) {
      clearInterval(this.positionIntervalId);
      this.positionIntervalId = undefined;
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = undefined;
    }
  }

  /** Returns static watchlist merged with unexpired AI-suggested symbols. */
  private getEffectivePairs(): string[] {
    const now = Date.now();
    for (const [symbol, addedAt] of this.dynamicPairs) {
      if (now - addedAt > 24 * 60 * 60 * 1000) this.dynamicPairs.delete(symbol);
    }
    const dynamic = Array.from(this.dynamicPairs.keys()).filter(s => !this.config.pairs.includes(s));
    return [...this.config.pairs, ...dynamic];
  }

  /** Ask AI to suggest new watchlist additions based on World Monitor news. Rate-limited to once every 6h. */
  private async suggestWatchlistAdditions(): Promise<void> {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    if (Date.now() - this.lastWatchlistSuggestAt < SIX_HOURS) return;
    this.lastWatchlistSuggestAt = Date.now();
    try {
      const news = await this.fetchWorldMonitorNews();
      if (news.length === 0) return;
      const nextjsUrl = process.env.NEXTJS_URL || 'http://localhost:3001';
      const res = await fetch(`${nextjsUrl}/api/trading/watchlist-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news, currentPairs: this.getEffectivePairs() }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const suggestions: string[] = data.suggestions ?? [];
      if (suggestions.length === 0) return;
      const now = Date.now();
      for (const symbol of suggestions) this.dynamicPairs.set(symbol, now);
      logActivity.info(`🔭 AI watchlist update: added ${suggestions.join(', ')} (active for 24h)`);
    } catch {
      // non-critical — never blocks trading
    }
  }

  /**
   * Check all markets and generate trading signals
   */
  private async checkMarkets(): Promise<void> {
    // IB reconnect-waiting mode: keep checking every cycle until IB comes back
    if (this.ibWaitingReconnect) {
      try {
        const health = await createIBClient().getHealth();
        if (health.connected) {
          this.ibWaitingReconnect = false;
          this.ibFailureCount = 0;
          logActivity.info('✅ IB reconnected — resuming trading');
          saveNotification('ib_disconnected', 'IB Reconnected', 'IB connection restored — bot resuming normal operation.');
        } else {
          logActivity.info('⏳ Waiting for IB to reconnect...');
        }
      } catch {
        logActivity.info('⏳ Still waiting for IB — connection not yet available');
      }
      return;
    }

    const session = getMarketSession();
    if (!session.isOpen && !session.isExtendedHours) {
      // Market fully closed — run pre-open prep near open, otherwise skip
      const mins = Math.round(session.nextOpenMs / 60000);
      const wait = mins > 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
      const todayStr = new Date().toDateString();
      if (mins <= 30 && this.preOpenPrepDone !== todayStr) {
        logActivity.info(`📚 Market opens in ${mins}m — running pre-open prep...`);
        await this.gatherOffHoursData();
        this.preOpenPrepDone = todayStr;
      } else {
        log.debug('Market closed, skipping cycle', { session: session.session, nextOpenIn: wait });
      }
      return;
    }

    // Skip during the 3:50–4:00 AM break between overnight and pre-market
    if (session.isBreak) {
      log.debug('Break window (3:50–4:00 AM ET), skipping cycle');
      return;
    }

    if (session.isExtendedHours) {
      logActivity.info(`⏰ Extended hours trading active — ${session.session}`);
    }

    // Skip signal generation during noisy open/close windows
    const noisy = isNoisyTradingPeriod();
    if (noisy.isNoisy) {
      logActivity.info(`⏸️ Skipping signals — ${noisy.reason} (positions still monitored)`);
      return;
    }

    // IB health check — stop engine after MAX_IB_FAILURES consecutive failures
    try {
      const health = await createIBClient().getHealth();
      if (!health.connected) throw new Error('IB reports disconnected');
      this.ibFailureCount = 0; // reset on success
    } catch (err: any) {
      this.ibFailureCount++;
      logActivity.error(`⚠️ IB health check failed (${this.ibFailureCount}/${this.MAX_IB_FAILURES}): ${err.message}`);
      if (this.ibFailureCount >= this.MAX_IB_FAILURES) {
        logActivity.error('🔴 IB unreachable — pausing engine. Will auto-resume when IB reconnects.');
        saveNotification('ib_disconnected', 'IB Connection Lost', 'Bot paused after 3 consecutive IB health check failures. Will auto-resume when IB reconnects.');
        void alertIBDisconnected(this.ibFailureCount);
        this.ibWaitingReconnect = true;
      }
      return;
    }

    this.lastHeartbeatAt = Date.now(); // Heartbeat: cycle started
    log.info('Checking markets', { pairs: this.config.pairs.length });
    logActivity.analyzing(`Checking markets for ${this.config.pairs.length} pairs...`);

    try {
      // Reset daily trade counter if new day
      this.resetDailyTradeCountIfNeeded();
      
      // Save portfolio snapshot before checking markets
      await this.savePortfolioSnapshot();
      
      // Ask AI to suggest new watchlist additions every 6 hours (fire-and-forget)
      void this.suggestWatchlistAdditions();

      // Pre-fetch all tickers once with a 2s stagger to respect IB pacing limits
      // This replaces the N² pattern where each generateSignal() fetched all tickers again
      const ib = createIBClient();
      const effectivePairs = this.getEffectivePairs();
      const marketData: Record<string, { price: number; volume: number; change24h: string }> = {};
      logActivity.analyzing(`Fetching live prices for ${effectivePairs.length} symbols (${this.dynamicPairs.size > 0 ? `${this.config.pairs.length} static + ${this.dynamicPairs.size} AI-suggested` : 'static watchlist'})...`);
      for (const symbol of effectivePairs) {
        try {
          const t = await ib.getTicker(symbol);
          const price = t.last ?? t.close ?? 0;
          if (price > 0) {
            this.priceLastSeenAt.set(symbol, Date.now());
            marketData[symbol] = { price, volume: t.volume ?? 0, change24h: '0' };
          } else {
            const lastSeen = this.priceLastSeenAt.get(symbol);
            const staleMs = lastSeen ? Date.now() - lastSeen : Infinity;
            if (session.isOpen && staleMs > 5 * 60 * 1000) {
              logActivity.warning(`⚠️ ${symbol}: no valid price in ${Math.round(staleMs / 60000)}min during market hours — skipping stale data`);
            }
            marketData[symbol] = { price: 0, volume: 0, change24h: '0' };
          }
        } catch {
          marketData[symbol] = { price: 0, volume: 0, change24h: '0' };
        }
        if (effectivePairs.indexOf(symbol) < effectivePairs.length - 1) {
          await new Promise(r => setTimeout(r, 2000)); // 2s between ticker requests
        }
      }

      // Fetch account balance once per cycle — passed to each generateSignal() call
      let availableCash = 10000;
      try {
        const balance = await ib.getBalance();
        const cashKey = Object.keys(balance).find(k => k.startsWith('AvailableFunds_'));
        if (cashKey) availableCash = parseFloat(balance[cashKey]);
        logActivity.info(`💵 Available cash: $${availableCash.toLocaleString()}`);
        // Balance drop alerting + daily account value for drawdown %
        const netLiqKey = Object.keys(balance).find(k => k.startsWith('NetLiquidation_'));
        if (netLiqKey) {
          this.dailyAccountValue = parseFloat(balance[netLiqKey]);
          void checkBalanceDrop(this.dailyAccountValue);
        }
      } catch {
        logActivity.warning('Could not fetch IB balance — using $10,000 fallback for position sizing');
      }

      // Daily drawdown guard — stop new signals if today's losses exceed the limit
      const dailyLossLimit = this.config.maxDailyLossPercent * this.dailyAccountValue;
      if (this.dailyRealizedPnl < -dailyLossLimit) {
        logActivity.warning(
          `🚫 Daily drawdown limit hit — today's P&L: $${this.dailyRealizedPnl.toFixed(2)} | ` +
          `Limit: -$${dailyLossLimit.toFixed(2)} (${(this.config.maxDailyLossPercent * 100).toFixed(1)}% of $${this.dailyAccountValue.toLocaleString()}) | ` +
          `No new trades until tomorrow`
        );
        return;
      }

      // Check each trading pair — 12s delay between analysis cycles to respect IB OHLC pacing
      for (const pair of effectivePairs) {
        try {
          logActivity.analyzing(`Analyzing ${pair}...`);
          await new Promise(r => setTimeout(r, 12000));
          const signal = await this.generateSignal(pair, marketData, availableCash);
          
          // Log the signal details
          logActivity.calculating(`${pair}: RSI ${signal.technicalSignals.rsi.toFixed(1)}, MACD ${signal.technicalSignals.macd.trend}, Confidence ${signal.confidence}%`);

          if (signal.action !== 'hold' && signal.confidence >= this.config.minConfidence) {
            // Check if trade is allowed (cooldown, daily limit, profit margin)
            const tradeAllowed = this.isTradeAllowed(signal);

            if (!tradeAllowed.allowed) {
              logActivity.warning(`❌ Trade blocked for ${pair}: ${tradeAllowed.reason}`);
              continue;
            }

            log.info('Signal generated', {
              pair,
              action: signal.action.toUpperCase(),
              confidence: signal.confidence,
              entry: signal.entryPrice.toFixed(2),
              stopLoss: signal.stopLoss.toFixed(2),
              takeProfit: signal.takeProfit.toFixed(2),
              positionSize: signal.positionSize,
              expectedProfitPct: tradeAllowed.expectedProfitPercent?.toFixed(2),
              reasoning: signal.reasoning,
            });

            logActivity.info(`🎯 Signal: ${signal.action.toUpperCase()} ${pair} | Confidence: ${signal.confidence}% | Entry: $${signal.entryPrice.toFixed(2)}`);
            logActivity.info(`📊 ${signal.reasoning}`);
            logActivity.info(`💰 Expected profit: ${tradeAllowed.expectedProfitPercent?.toFixed(2)}% after ${(this.config.tradingFeePercent * 200).toFixed(2)}% fees`);

            // Save signal to database (sentiment returned alongside signal)
            void saveSignalToDb(signal, signal.marketSentiment).catch(e =>
              log.error('saveSignalToDb escaped internal catch', { error: String(e) })
            );

            if (this.config.autoExecute) {
              await this.executeSignal(signal);
            } else {
              logActivity.warning(`Validation mode: Would ${signal.action.toUpperCase()} ${pair} at $${signal.entryPrice.toFixed(2)}`);
            }
          } else if (signal.action === 'hold') {
            logActivity.info(`${pair}: HOLD | Confidence: ${signal.confidence}% | ${signal.reasoning}`);
          }
        } catch (error) {
          log.error(`Error checking pair`, { pair, error: String(error) });
          logActivity.error(`Failed to analyze ${pair}: ${error}`);
        }
      }

      logActivity.completed(`Market check complete. Active positions: ${this.activePositions.size}`);
    } catch (error) {
      log.error('checkMarkets failed', { error: String(error) });
      logActivity.error(`Market check failed: ${error}`);
    }
  }

  /**
   * Off-hours prep: fetch OHLC history + news + AI sentiment so the bot is
   * ready to act the moment the market opens. No live tickers, no execution.
   */
  private async gatherOffHoursData(): Promise<void> {
    log.info('Running pre-open prep');

    const news = await this.fetchWorldMonitorNews();

    for (const pair of this.config.pairs) {
      try {
        const priceData = await getHistoricalPrices(pair, 1440); // daily bars via Yahoo fallback
        if (priceData.length < 50) {
          logActivity.warning(`Off-hours prep: insufficient history for ${pair}, skipping`);
          continue;
        }

        const technicalSignals = analyzeTechnicalIndicators(priceData);
        const currentPrice = priceData[priceData.length - 1].close;

        const technicalsForAI = {
          rsi: technicalSignals.rsi,
          rsiSignal: technicalSignals.rsiSignal,
          macd: technicalSignals.macd,
          bollingerBands: technicalSignals.bollingerBands,
          ema: technicalSignals.ema,
          volume: technicalSignals.volume,
        };

        const aiAnalysis = await this.getAISentimentAnalysis(
          pair, news, { price: currentPrice, volume: 0, change24h: '0' }, technicalsForAI,
        );

        const sentiment = aiAnalysis?.sentiment ?? 'neutral';
        logActivity.info(
          `📚 [Off-hours] ${pair}: RSI ${technicalSignals.rsi.toFixed(1)}, MACD ${technicalSignals.macd.trend}, AI ${sentiment} — ready for open`,
        );
      } catch (err) {
        logActivity.warning(`Off-hours prep failed for ${pair}: ${err}`);
      }
    }

    logActivity.completed(`Off-hours prep complete for ${this.config.pairs.length} symbols.`);
  }

  /**
   * Fetch news from World Monitor
   */
  private async fetchWorldMonitorNews(): Promise<any[]> {
    const worldMonitorUrl = process.env.WORLDMONITOR_URL || 'http://localhost:3000';
    try {
      const response = await fetch(`${worldMonitorUrl}/api/worldmonitor/news`);
      if (!response.ok) {
        log.warn('Failed to fetch World Monitor news, continuing with technical analysis only');
        return [];
      }
      const data = await response.json();
      return data.news || [];
    } catch (error) {
      log.warn('World Monitor not available, continuing with technical analysis only');
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

      const nextjsUrl = process.env.NEXTJS_URL || 'http://localhost:3001';
      const response = await fetch(`${nextjsUrl}/api/trading/analyze`, {
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
      log.warn('AI sentiment analysis not available');
      return null;
    }
  }

  /**
   * Generate trading signal for a pair
   */
  async generateSignal(pair: string, marketData: Record<string, { price: number; volume: number; change24h: string }>, availableCash: number = 10000): Promise<TradeSignal> {
    // Use daily bars — reliable, no IB pacing issues, good for swing trading signals
    const priceData = await getHistoricalPrices(pair, 1440);

    // Persist candles to DB (fire and forget — never blocks signal generation)
    void savePriceCandles(pair, 1440, priceData).catch(e =>
      log.error('savePriceCandles escaped internal catch', { error: String(e) })
    );

    if (priceData.length < 50) {
      throw new Error(`Insufficient price data for ${pair}`);
    }

    // Analyze technical indicators
    const technicalSignals = analyzeTechnicalIndicators(priceData);
    const currentPrice = priceData[priceData.length - 1].close;

    // 1-hour MTF trend score: +1 per bullish indicator, -1 per bearish (-2 to +2)
    let h1TrendScore = 0;
    try {
      const h1Data = await getHistoricalPrices(pair, 60);
      if (h1Data.length >= 20) {
        const h1 = analyzeTechnicalIndicators(h1Data);
        if (h1.ema.trend === 'bullish')  h1TrendScore++;
        else if (h1.ema.trend === 'bearish') h1TrendScore--;
        if (h1.macd.trend === 'bullish') h1TrendScore++;
        else if (h1.macd.trend === 'bearish') h1TrendScore--;
        logActivity.calculating(`${pair}: 1H EMA=${h1.ema.trend} MACD=${h1.macd.trend} (MTF score: ${h1TrendScore > 0 ? '+' : ''}${h1TrendScore})`);
      }
    } catch {
      // 1h data unavailable — proceed without MTF filter
    }

    // Fetch World Monitor news for fundamental analysis
    const news = await this.fetchWorldMonitorNews();

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
        if (aiAnalysis.signal === 'BUY') { action = 'buy'; confidence = Math.min(confidence + AGREEMENT_CONFIDENCE_BOOST, 100); }
        else if (aiAnalysis.signal === 'SELL') { action = 'hold'; confidence = 50; }
        else { action = 'buy'; }
      } else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') {
        if (aiAnalysis.signal === 'SELL') { action = 'sell'; confidence = Math.min(confidence + AGREEMENT_CONFIDENCE_BOOST, 100); }
        else if (aiAnalysis.signal === 'BUY') { action = 'hold'; confidence = 50; }
        else { action = 'sell'; }
      } else {
        if (aiAnalysis.signal === 'BUY' && aiAnalysis.confidence >= AI_ONLY_MIN_CONFIDENCE) action = 'buy';
        else if (aiAnalysis.signal === 'SELL' && aiAnalysis.confidence >= AI_ONLY_MIN_CONFIDENCE) action = 'sell';
      }
    } else {
      if (technicalSignals.overallSignal === 'strong_buy' || technicalSignals.overallSignal === 'buy') action = 'buy';
      else if (technicalSignals.overallSignal === 'strong_sell' || technicalSignals.overallSignal === 'sell') action = 'sell';
    }

    // ── SPY downtrend: hard block BUY, allow SELL ────────────────────────────
    // In a downtrend don't buy dips — but SELL signals are valid and desirable.
    if (action === 'buy' && marketSentiment?.spyTrend.trend === 'downtrend') {
      logActivity.warning(`${pair}: SPY downtrend — BUY blocked. SELL signals still allowed.`);
      action = 'hold';
    }

    // Apply sentiment penalty — reduce confidence when market is bearish
    if (marketSentiment && marketSentiment.overallSentiment === 'Bearish') {
      if (action === 'buy') confidence = Math.max(0, confidence - BEARISH_SENTIMENT_CONFIDENCE_PENALTY);
    }

    // ── Micro filter 1: Volume confirmation ──────────────────────────────────
    // Require at least 1.3× average volume to confirm the move is real.
    if (action !== 'hold') {
      const volumeRatio = technicalSignals.volume.average > 0
        ? technicalSignals.volume.current / technicalSignals.volume.average
        : 1;
      if (volumeRatio < VOLUME_CONFIRMATION_RATIO) {
        logActivity.warning(`${pair}: Weak volume (${volumeRatio.toFixed(1)}× avg) — insufficient conviction. Switching to HOLD.`);
        action = 'hold';
      }
    }

    // ── Micro filter 2: Bollinger Band + RSI alignment ───────────────────────
    // Below lower band is only a valid long if RSI confirms oversold (<40).
    // Above upper band is only a valid short if RSI confirms overbought (>60).
    if (action === 'buy' && technicalSignals.bollingerBands.position === 'below') {
      if (technicalSignals.rsi >= BB_BELOW_RSI_MAX) {
        logActivity.warning(`${pair}: Below BB but RSI not oversold (${technicalSignals.rsi.toFixed(0)}) — false signal. HOLD.`);
        action = 'hold';
      }
    }
    if (action === 'sell' && technicalSignals.bollingerBands.position === 'above') {
      if (technicalSignals.rsi <= BB_ABOVE_RSI_MIN) {
        logActivity.warning(`${pair}: Above BB but RSI not overbought (${technicalSignals.rsi.toFixed(0)}) — false signal. HOLD.`);
        action = 'hold';
      }
    }

    // ── Micro filter 3: VIX + MACD stability ─────────────────────────────────
    // At elevated VIX (>22), require MACD histogram > 0 to confirm trend has
    // actual momentum behind it — not just a noise spike.
    if (action !== 'hold' && (marketSentiment?.vix.value ?? 0) > ELEVATED_VIX_MACD_THRESHOLD) {
      if (technicalSignals.macd.histogram <= 0) {
        logActivity.warning(`${pair}: Elevated VIX + MACD histogram ≤ 0 (${technicalSignals.macd.histogram.toFixed(2)}) — no momentum. HOLD.`);
        action = 'hold';
      }
    }

    // ── Micro filter 4: Multi-timeframe confirmation ─────────────────────────
    // 1H EMA + MACD must not contradict the daily signal direction.
    // Opposition cuts confidence by 20pts (blocks if below minConfidence).
    // Agreement gives a small +5pt boost.
    if (action !== 'hold' && h1TrendScore !== 0) {
      const opposed = (action === 'buy' && h1TrendScore < 0) || (action === 'sell' && h1TrendScore > 0);
      const aligned = (action === 'buy' && h1TrendScore > 0) || (action === 'sell' && h1TrendScore < 0);
      if (opposed) {
        confidence = Math.max(0, confidence - 20);
        logActivity.warning(`${pair}: 1H trend opposes ${action.toUpperCase()} signal — confidence cut to ${confidence}%`);
        if (confidence < this.config.minConfidence) {
          action = 'hold';
          logActivity.warning(`${pair}: MTF filter blocked signal (confidence ${confidence}% < threshold ${this.config.minConfidence}%)`);
        }
      } else if (aligned) {
        confidence = Math.min(100, confidence + 5);
        logActivity.info(`${pair}: 1H confirms ${action.toUpperCase()} — confidence +5 → ${confidence}%`);
      }
    }

    // ── Step 5: Fee-aware position sizing via ATR ─────────────────────────────
    // availableCash is passed in from checkMarkets() — fetched once per cycle, not per pair

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
      marketSentiment,
    };
  }

  /**
   * Reset daily trade counter if it's a new day
   */
  private resetDailyTradeCountIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTradeCount = 0;
      this.dailyRealizedPnl = 0;
      this.lastResetDate = today;
      logActivity.info(`📅 New trading day started. Daily counters reset.`);
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

    // Sector concentration cap — avoid stacking correlated names
    const sector = SECTOR_MAP[signal.pair] ?? 'other';
    const sectorCount = Array.from(this.activePositions.values())
      .filter(p => (SECTOR_MAP[p.pair] ?? 'other') === sector).length;
    if (sectorCount >= this.config.maxPositionsPerSector) {
      return {
        allowed: false,
        reason: `Sector cap (${sector}): ${sectorCount}/${this.config.maxPositionsPerSector} positions already open`,
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
      log.info('Executing order', { action: signal.action.toUpperCase(), pair: signal.pair });
      logActivity.executing(`Executing ${signal.action.toUpperCase()} order for ${signal.pair}...`);

      const ib = createIBClient();

      if (signal.action === 'hold') return;

      // Fetch IB positions once — used for both BUY and SELL guards below
      const ibPositions = await ib.getPositions();

      // For BUY: skip if IB already holds shares of this symbol (avoids doubling up on
      // positions the bot lost track of after a restart)
      if (signal.action === 'buy') {
        const existing = ibPositions.find(p => p.symbol === signal.pair && p.position > 0);
        if (existing) {
          logActivity.warning(`⚠️ Skipping BUY for ${signal.pair}: already holding ${existing.position} shares in IB (untracked position). Will wait for bot to re-enter after next exit.`);
          return;
        }
      }

      // For SELL: verify we actually hold shares via IB positions
      if (signal.action === 'sell') {
        const pos = ibPositions.find(p => p.symbol === signal.pair && p.position > 0);
        if (!pos) {
          logActivity.warning(`Cannot sell ${signal.pair}: No IB position found`);
          return;
        }
        // Sell only what we own
        signal.positionSize = Math.min(signal.positionSize, pos.position);
        logActivity.info(`✅ IB position found: ${pos.position} shares of ${signal.pair}`);
      }

      let posId: string;
      let parentOrderId: number | undefined;
      let slOrderId: number | undefined;
      let tpOrderId: number | undefined;

      if (this.config.autoExecute) {
        // Live mode: place a bracket order so IB manages SL/TP natively.
        // This survives any process restart — exits are on IB's servers.
        // Use a limit order entry (0.5% above current price for BUY, 0.5% below for SELL)
        // This prevents overpaying if the stock gaps up/down overnight
        const limitSlippage = ENTRY_LIMIT_SLIPPAGE;
        const entryLimit = signal.action === 'buy'
          ? parseFloat((signal.entryPrice * (1 + limitSlippage)).toFixed(2))
          : parseFloat((signal.entryPrice * (1 - limitSlippage)).toFixed(2));

        const tradeSession = getMarketSession();
        if (tradeSession.isExtendedHours) {
          logActivity.info(`🌙 Extended hours order — session: ${tradeSession.session} | venue: ${tradeSession.ibSessionVenue}`);
        }

        const bracket = await ib.placeBracketOrder({
          symbol:           signal.pair,
          action:           signal.action === 'buy' ? 'BUY' : 'SELL',
          quantity:         signal.positionSize,
          stop_loss_price:  signal.stopLoss,
          take_profit_price: signal.takeProfit,
          limit_price:      entryLimit,
          outside_rth:      tradeSession.isExtendedHours,
          overnight:        tradeSession.isOvernight,
          validate_only:    false,
        });

        logActivity.info(`📋 Entry limit order @ $${entryLimit.toFixed(2)} (0.5% buffer vs signal $${signal.entryPrice.toFixed(2)})`);

        parentOrderId = bracket.parent_order_id;
        slOrderId     = bracket.stop_loss_order_id;
        tpOrderId     = bracket.take_profit_order_id;
        posId         = bracket.parent_order_id?.toString() ?? `${signal.pair}-${Date.now()}`;

        logActivity.completed(`✅ ${signal.action.toUpperCase()} ${signal.positionSize} ${signal.pair} at $${signal.entryPrice.toFixed(2)} | OrderID: ${parentOrderId}`);
        logActivity.info(`🛡️ Stop-loss order #${slOrderId}: $${signal.stopLoss.toFixed(2)} | 🎯 Take-profit order #${tpOrderId}: $${signal.takeProfit.toFixed(2)} (native IB bracket)`);
        this.lastTradeTime.set(signal.pair, Date.now());
        this.dailyTradeCount++;
        logActivity.info(`📊 Daily trades: ${this.dailyTradeCount}/${this.config.maxDailyTrades}`);
        saveNotification(
          'trade_executed',
          `${signal.action.toUpperCase()} ${signal.pair}`,
          `${signal.positionSize} shares at $${signal.entryPrice.toFixed(2)} | OrderID: ${parentOrderId} | SL: $${signal.stopLoss.toFixed(2)} TP: $${signal.takeProfit.toFixed(2)}`,
          signal.pair,
        );
      } else {
        // Paper/validation mode: validate the parent order only (what-if check).
        const result = await ib.placeOrder({
          symbol:        signal.pair,
          action:        signal.action === 'buy' ? 'BUY' : 'SELL',
          quantity:      signal.positionSize,
          order_type:    'MKT',
          validate_only: true,
        });
        posId = `${signal.pair}-${Date.now()}`;
        logActivity.completed(`✅ Order validated (paper mode) — would ${signal.action.toUpperCase()} ${signal.positionSize} shares of ${signal.pair} at $${signal.entryPrice.toFixed(2)}`);
        if (result.commission) logActivity.info(`💰 Estimated commission: $${result.commission}`);
      }

      // Save open trade to DB (fire-and-forget, non-blocking)
      let dbTradeId: number | undefined;
      if (this.config.autoExecute) {
        try {
          const { prisma } = await import('./db');
          const expectedProfitUSD = parseFloat(
            (signal.positionSize * (signal.takeProfit - signal.entryPrice)).toFixed(2)
          );
          const expectedLossUSD = parseFloat(
            (signal.positionSize * (signal.entryPrice - signal.stopLoss)).toFixed(2)
          );
          const riskRewardRatio = expectedLossUSD > 0
            ? parseFloat((expectedProfitUSD / expectedLossUSD).toFixed(2))
            : null;

          logActivity.info(
            `🎯 Expected profit if TP hits: $${expectedProfitUSD.toFixed(2)} | ` +
            `Expected loss if SL hits: -$${expectedLossUSD.toFixed(2)} | ` +
            `R:R ratio: ${riskRewardRatio ?? 'N/A'}`
          );

          const dbTrade = await prisma.trade.create({
            data: {
              pair:              signal.pair,
              type:              signal.action,
              entryPrice:        signal.entryPrice,
              volume:            signal.positionSize,
              stopLoss:          signal.stopLoss,
              takeProfit:        signal.takeProfit,
              status:            'open',
              txid:              posId,
              slOrderId:         slOrderId  ?? null,
              tpOrderId:         tpOrderId  ?? null,
              expectedProfitUSD,
              expectedLossUSD,
              riskRewardRatio,
            },
          });
          dbTradeId = dbTrade.id;
        } catch (e) {
          log.error('DB failed to save trade', { error: String(e) });
        }
      }

      const expectedProfitUSD_ = parseFloat(
        (signal.positionSize * (signal.takeProfit - signal.entryPrice)).toFixed(2)
      );
      const expectedLossUSD_ = parseFloat(
        (signal.positionSize * (signal.entryPrice - signal.stopLoss)).toFixed(2)
      );

      this.activePositions.set(posId, {
        txid:              posId,
        pair:              signal.pair,
        type:              signal.action,
        entryPrice:        signal.entryPrice,
        volume:            signal.positionSize,
        stopLoss:          signal.stopLoss,
        takeProfit:        signal.takeProfit,
        currentPrice:      signal.entryPrice,
        pnl:               0,
        pnlPercent:        0,
        timestamp:         signal.timestamp,
        dbTradeId,
        parentOrderId,
        slOrderId,
        tpOrderId,
        expectedProfitUSD: expectedProfitUSD_,
        expectedLossUSD:   expectedLossUSD_,
        riskRewardRatio:   expectedLossUSD_ > 0
          ? parseFloat((expectedProfitUSD_ / expectedLossUSD_).toFixed(2))
          : undefined,
      });
    } catch (error: any) {
      log.error('Failed to execute order', { pair: signal.pair, action: signal.action, error: error.message });
      logActivity.error(`Failed to execute ${signal.action} order for ${signal.pair}: ${error.message}`);
      saveNotification(
        'trade_failed',
        `Order Failed — ${signal.pair}`,
        `${signal.action.toUpperCase()} ${signal.positionSize} shares: ${error.message}`,
        signal.pair,
      );
    }
  }

  /**
   * Update active positions: refresh P&L from live prices and detect IB-native closes.
   *
   * When autoExecute=true, SL/TP are native IB bracket orders — IB closes the position
   * automatically. We detect this by checking whether IB still holds shares. If the
   * IB position is gone, the bracket order fired and we update the DB accordingly.
   *
   * For paper mode (autoExecute=false) we still do the manual shouldClosePosition check
   * since no real IB orders exist to monitor.
   */
  private async updatePositions(): Promise<void> {
    if (this.activePositions.size === 0) return;

    try {
      const ib = createIBClient();

      // Fetch IB positions once for all symbols (used to detect native bracket closes)
      let ibPositions: Awaited<ReturnType<typeof ib.getPositions>> = [];
      if (this.config.autoExecute) {
        try {
          ibPositions = await ib.getPositions();
        } catch {
          // Non-fatal; P&L update continues without close detection this cycle
        }
      }

      for (const [txid, position] of this.activePositions) {
        // Update current price and P&L
        try {
          const ticker = await ib.getTicker(position.pair);
          let resolvedPrice: number | null = ticker.last ?? ticker.close ?? null;
          if (resolvedPrice === null) {
            // IB not streaming (after hours / weekend) — fall back to last hourly close
            // so P&L shows a real price instead of $0 or entry price.
            try {
              const bars = await getHistoricalPrices(position.pair, 60);
              if (bars.length > 0) resolvedPrice = bars[bars.length - 1].close;
            } catch { /* non-fatal — keep last known value */ }
          }
          const currentPrice: number = resolvedPrice ?? position.currentPrice;
          position.currentPrice = currentPrice;

          if (position.type === 'buy') {
            position.pnl        = (currentPrice - position.entryPrice) * position.volume;
            position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
            if (!position.highestPrice || currentPrice > position.highestPrice) position.highestPrice = currentPrice;
          } else {
            position.pnl        = (position.entryPrice - currentPrice) * position.volume;
            position.pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
            if (!position.lowestPrice || currentPrice < position.lowestPrice) position.lowestPrice = currentPrice;
          }

          // Log progress toward profit target if we know it
          if (position.expectedProfitUSD && position.expectedProfitUSD > 0) {
            const progressPct = Math.min(
              ((position.pnl / position.expectedProfitUSD) * 100),
              100
            ).toFixed(1);
            const progressBar = '█'.repeat(Math.floor(parseFloat(progressPct) / 10))
                              + '░'.repeat(10 - Math.floor(parseFloat(progressPct) / 10));
            logActivity.info(
              `📈 ${position.pair} — P&L: $${position.pnl.toFixed(2)} / target $${position.expectedProfitUSD.toFixed(2)} ` +
              `[${progressBar}] ${progressPct}% | ` +
              `SL: $${position.stopLoss.toFixed(2)} (-$${position.expectedLossUSD?.toFixed(2) ?? '?'}) | ` +
              `TP: $${position.takeProfit.toFixed(2)}`
            );
          }
        } catch {
          // Price fetch failed; keep previous values and continue
        }

        if (this.config.autoExecute) {
          // ── Native bracket mode: detect close by checking IB position ──────

          // Guard 1: if IB returned an empty position list, it likely means a
          // connectivity blip — never treat "all gone" as "all closed".
          const ibDataTrusted = ibPositions.length > 0;

          // Guard 2: skip close detection for positions younger than 120 seconds.
          // IB can take up to a minute to reflect a new fill in getPositions().
          const positionAgeMs  = Date.now() - position.timestamp;
          const positionMature = positionAgeMs >= 120_000;

          const ibPos = ibPositions.find(p => p.symbol === position.pair && p.position > 0);
          if (!ibPos && ibDataTrusted && positionMature) {
            // IB no longer holds shares → bracket SL or TP fired
            // Total P&L = remaining-half P&L + any locked partial P&L
            const totalPnl = position.pnl + (position.partialPnl ?? 0);
            const closeReason = totalPnl > 0 ? 'take_profit' : totalPnl < 0 ? 'stop_loss' : 'unknown';
            const partialNote = position.partialPnl ? ` (incl. $${position.partialPnl.toFixed(2)} partial)` : '';
            log.info('IB bracket closed position', { pair: position.pair, closeReason, pnl: totalPnl.toFixed(2), pnlPct: position.pnlPercent.toFixed(2) });
            logActivity.completed(`✅ Position closed by IB — ${position.pair} | Total P&L: $${totalPnl.toFixed(2)}${partialNote} | Reason: ${closeReason}`);
            saveNotification(
              'trade_closed',
              `Position Closed — ${position.pair}`,
              `${closeReason.replace('_', ' ')} hit | Total P&L: $${totalPnl.toFixed(2)}${partialNote}`,
              position.pair,
            );

            this.dailyRealizedPnl += totalPnl;

            if (position.dbTradeId) {
              import('./db').then(({ prisma }) =>
                prisma.trade.update({
                  where: { id: position.dbTradeId },
                  data: {
                    exitPrice:   position.currentPrice,
                    pnl:         totalPnl,
                    pnlPercent:  position.pnlPercent,
                    status:      'closed',
                    closedAt:    new Date(),
                    closeReason,
                  },
                })
              ).catch(e => log.error('DB failed to update trade on close', { error: String(e) }));
            }

            this.activePositions.delete(txid);
          } else if (!ibPos && !ibDataTrusted) {
            log.warn('Close detection skipped — IB returned empty positions list (connectivity blip?)', { pair: position.pair });
          } else if (!ibPos && !positionMature) {
            log.info('Close detection skipped — position too young for IB to reflect fill', {
              pair: position.pair, ageMs: Math.round(positionAgeMs), minAgeMs: 120_000,
            });
          } else {
            // ── Partial profit: sell half at 5%, let rest ride ────────────────
            if (!position.partialTaken && position.pnlPercent >= this.config.partialProfitPercent * 100) {
              const halfShares = Math.floor(position.volume / 2);
              if (halfShares >= 1) {
                const partialPnl = (position.type === 'buy'
                  ? (position.currentPrice - position.entryPrice)
                  : (position.entryPrice - position.currentPrice)) * halfShares;

                logActivity.info(`🎯 Partial profit — ${position.pair} | Selling ${halfShares}/${position.volume} shares at +${position.pnlPercent.toFixed(1)}% | Locking in $${partialPnl.toFixed(2)}`);

                let partialSuccess = false;
                try {
                  // Cancel existing full-size SL + TP first, plus any orphaned orders
                  if (position.slOrderId) await ib.cancelOrder(position.slOrderId).catch(() => {});
                  if (position.tpOrderId) await ib.cancelOrder(position.tpOrderId).catch(() => {});
                  await ib.cancelOrdersForSymbol(position.pair).catch(() => {});

                  // Sell half at market
                  await ib.placeOrder({
                    symbol:        position.pair,
                    action:        position.type === 'buy' ? 'SELL' : 'BUY',
                    quantity:      halfShares,
                    order_type:    'MKT',
                    validate_only: false,
                  });
                  partialSuccess = true;
                } catch (e) {
                  log.error('Partial profit market sell failed', { pair: position.pair, error: String(e) });
                }

                if (partialSuccess) {
                  const remainingShares = position.volume - halfShares;
                  try {
                    // Move stop to entry + 2.5% for the remaining half — guarantees
                    // the second half can't end as a loss after partial profit fired.
                    const guaranteedStop = parseFloat(
                      (position.type === 'buy'
                        ? position.entryPrice * 1.025
                        : position.entryPrice * 0.975
                      ).toFixed(2)
                    );
                    // Never move stop backwards — use the better of new floor vs existing stop
                    const newStop = position.type === 'buy'
                      ? Math.max(guaranteedStop, position.stopLoss)
                      : Math.min(guaranteedStop, position.stopLoss);

                    logActivity.info(`🔒 Stop moved to +2.5% above entry — ${position.pair} | SL: $${position.stopLoss.toFixed(2)} → $${newStop.toFixed(2)} (2nd half now guaranteed profit)`);

                    // Replace protection with OCA pair sized for remaining shares
                    const ocaResult = await ib.placeOcaOrder({
                      symbol:        position.pair,
                      action:        position.type === 'buy' ? 'SELL' : 'BUY',
                      quantity:      remainingShares,
                      stop_price:    newStop,
                      limit_price:   position.takeProfit,
                      validate_only: false,
                    });
                    position.stopLoss = newStop;
                    if (ocaResult.stop_order_id)  position.slOrderId = ocaResult.stop_order_id;
                    if (ocaResult.limit_order_id) position.tpOrderId = ocaResult.limit_order_id;
                  } catch (e) {
                    log.error('Failed to re-place OCA after partial profit', { pair: position.pair, error: String(e) });
                  }

                  position.partialTaken = true;
                  position.partialPnl   = partialPnl;
                  position.volume       = remainingShares;

                  saveNotification(
                    'trade_closed',
                    `Partial Profit — ${position.pair}`,
                    `Sold ${halfShares} shares at +${position.pnlPercent.toFixed(1)}% | $${partialPnl.toFixed(2)} locked | ${remainingShares} shares still running`,
                    position.pair,
                  );

                  if (position.dbTradeId) {
                    import('./db').then(({ prisma }) =>
                      prisma.trade.update({
                        where: { id: position.dbTradeId },
                        data: {
                          volume:    remainingShares,
                          stopLoss:  position.stopLoss,   // persist raised stop (+2.5%)
                          slOrderId: position.slOrderId ?? null,
                          tpOrderId: position.tpOrderId ?? null,
                          closeTxid: 'partial_taken', // flag survives restart — recoverPositions() reads this
                        },
                      })
                    ).catch(e => log.error('DB failed to update partial profit', { error: String(e) }));
                  }
                } else {
                  // Sell failed — restore full-size protection so position is not naked
                  ib.placeOcaOrder({
                    symbol:        position.pair,
                    action:        position.type === 'buy' ? 'SELL' : 'BUY',
                    quantity:      position.volume,
                    stop_price:    position.stopLoss,
                    limit_price:   position.takeProfit,
                    validate_only: false,
                  }).then(r => {
                    if (r.stop_order_id)  position.slOrderId = r.stop_order_id;
                    if (r.limit_order_id) position.tpOrderId = r.limit_order_id;
                  }).catch(e => log.error('Failed to restore OCA after partial sell failure', { pair: position.pair, error: String(e) }));
                }
              }
            }

            // ── Position still open: ratchet IB stop upward with trailing stop ──
            // Instead of firing a software market exit, we move the actual IB
            // stop-loss order up to the trailing floor and replace both exit
            // orders with a fresh OCA pair. This way the floor survives a bot
            // restart — IB holds the updated stop on its servers, and the DB
            // stores the new stopLoss + order IDs for recoverPositions().
            const profitFrac = position.type === 'buy'
              ? (position.currentPrice - position.entryPrice) / position.entryPrice
              : (position.entryPrice - position.currentPrice) / position.entryPrice;

            if (profitFrac >= this.config.trailingActivationPercent) {
              const highWater    = position.highestPrice ?? position.entryPrice;
              const lowWater     = position.lowestPrice  ?? position.entryPrice;
              const newStopPrice = parseFloat(
                (position.type === 'buy'
                  ? highWater * (1 - this.config.trailingStopPercent)
                  : lowWater  * (1 + this.config.trailingStopPercent)
                ).toFixed(2)
              );

              // Only ratchet when stop improved by ≥ 0.5% — avoids constant order churn
              const stopImproved = position.type === 'buy'
                ? newStopPrice >= position.stopLoss * 1.005
                : newStopPrice <= position.stopLoss * 0.995;

              // Skip ratchet if we already ratcheted within the last minute — prevents
              // duplicate OCA orders if two consecutive 30s cycles both see stopImproved
              const ratchetReady = !position.lastRatchetAt ||
                (Date.now() - position.lastRatchetAt) >= RATCHET_MIN_INTERVAL_MS;

              if (stopImproved && position.slOrderId && ratchetReady) {
                log.info('Ratcheting trailing stop on IB', { pair: position.pair, oldStop: position.stopLoss.toFixed(2), newStop: newStopPrice.toFixed(2), peak: highWater.toFixed(2) });
                logActivity.info(`🔼 Trailing stop raised — ${position.pair} | SL: $${position.stopLoss.toFixed(2)} → $${newStopPrice.toFixed(2)} (peak: $${highWater.toFixed(2)})`);

                try {
                  // Cancel SL first — if this fails we abort to avoid duplicate stops on IB
                  if (position.slOrderId) await ib.cancelOrder(position.slOrderId);
                  // Cancel TP best-effort — new OCA will include a fresh TP anyway
                  if (position.tpOrderId) await ib.cancelOrder(position.tpOrderId).catch(e =>
                    log.warn('TP cancel failed during ratchet — placing fresh TP anyway', { pair: position.pair, error: String(e) })
                  );

                  const ocaResult = await ib.placeOcaOrder({
                    symbol:        position.pair,
                    action:        position.type === 'buy' ? 'SELL' : 'BUY',
                    quantity:      position.volume,
                    stop_price:    newStopPrice,
                    limit_price:   position.takeProfit,
                    validate_only: false,
                  });

                  // Update in-memory state
                  position.stopLoss     = newStopPrice;
                  position.lastRatchetAt = Date.now();
                  if (ocaResult.stop_order_id)  position.slOrderId = ocaResult.stop_order_id;
                  if (ocaResult.limit_order_id) position.tpOrderId = ocaResult.limit_order_id;

                  // Persist to DB — recoverPositions() reloads these on restart
                  if (position.dbTradeId) {
                    import('./db').then(({ prisma }) =>
                      prisma.trade.update({
                        where: { id: position.dbTradeId },
                        data: {
                          stopLoss:  newStopPrice,
                          slOrderId: ocaResult.stop_order_id  ?? position.slOrderId,
                          tpOrderId: ocaResult.limit_order_id ?? position.tpOrderId,
                        },
                      })
                    ).catch(e => log.error('DB failed to persist ratcheted trailing stop', { error: String(e) }));
                  }
                } catch (e) {
                  // SL cancel threw — position still protected by old stop, skip this cycle
                  log.warn('Ratchet aborted — old SL still active on IB', { pair: position.pair, error: String(e) });
                }
              }
            }

            // ── Time-based exit: recycle capital stuck near entry for 5+ days ──
            // A trade that hasn't reached +1% after DEFAULT_MAX_HOLD_DAYS is unlikely
            // to reach its target — better to free up the slot for fresh opportunities.
            const holdDays = (Date.now() - position.timestamp) / (1000 * 60 * 60 * 24);
            const stuckAtEntry = position.pnlPercent < 1.0;
            if (holdDays >= DEFAULT_MAX_HOLD_DAYS && stuckAtEntry) {
              logActivity.warning(
                `⏳ Time-based exit — ${position.pair} | Open ${holdDays.toFixed(1)} days, P&L: ${position.pnlPercent.toFixed(1)}% — recycling capital`
              );
              try {
                // Cancel known order IDs first, then cancel all remaining open orders
                // for this symbol as a safety net (handles bot-restart ID loss)
                if (position.slOrderId) await ib.cancelOrder(position.slOrderId).catch(() => {});
                if (position.tpOrderId) await ib.cancelOrder(position.tpOrderId).catch(() => {});
                await ib.cancelOrdersForSymbol(position.pair).catch(() => {});
                await ib.placeOrder({
                  symbol:        position.pair,
                  action:        position.type === 'buy' ? 'SELL' : 'BUY',
                  quantity:      position.volume,
                  order_type:    'MKT',
                  validate_only: false,
                });
                this.dailyRealizedPnl += position.pnl;
                if (position.dbTradeId) {
                  import('./db').then(({ prisma }) =>
                    prisma.trade.update({
                      where: { id: position.dbTradeId },
                      data: {
                        status:      'closed',
                        closedAt:    new Date(),
                        exitPrice:   position.currentPrice,
                        pnl:         position.pnl,
                        pnlPercent:  position.pnlPercent,
                        closeReason: 'time_exit',
                      },
                    })
                  ).catch(e => log.error('DB failed to update time-based exit', { error: String(e) }));
                }
                saveNotification(
                  'trade_closed',
                  `Time Exit — ${position.pair}`,
                  `Closed after ${holdDays.toFixed(1)} days with no progress | P&L: $${position.pnl.toFixed(2)} (${position.pnlPercent.toFixed(1)}%)`,
                  position.pair,
                );
                this.activePositions.delete(txid);
              } catch (e) {
                log.error('Time-based exit failed', { pair: position.pair, error: String(e) });
              }
            }
          }
        } else {
          // ── Paper mode: manual SL/TP + trailing stop check ────────────────
          const shouldClose = this.riskManager.shouldClosePosition({
            pair:         position.pair,
            type:         position.type,
            entryPrice:   position.entryPrice,
            volume:       position.volume,
            stopLoss:     position.stopLoss,
            takeProfit:   position.takeProfit,
            currentPrice: position.currentPrice,
            highestPrice: position.highestPrice,
            lowestPrice:  position.lowestPrice,
            entryTime:    position.timestamp,
          });

          if (shouldClose.shouldClose) {
            this.dailyRealizedPnl += position.pnl;
            log.info('Paper position closed', { pair: position.pair, reason: shouldClose.reason, entry: position.entryPrice.toFixed(2), current: position.currentPrice.toFixed(2), pnl: position.pnl.toFixed(2) });
            logActivity.completed(`✅ Paper position closed — ${position.pair} | P&L: $${position.pnl.toFixed(2)} (${position.pnlPercent.toFixed(2)}%) | Reason: ${shouldClose.reason}`);
            this.activePositions.delete(txid);
          }
        }
      }
    } catch (error) {
      log.error('Error updating positions', { error: String(error) });
    }
  }

  /**
   * Recover open positions from the database on startup.
   *
   * Cross-references DB open trades with actual IB positions:
   * - If IB still holds shares → restore to activePositions (bracket orders are still live on IB)
   * - If IB no longer holds shares → the position closed while the bot was offline; mark it closed
   */
  async recoverPositions(): Promise<void> {
    try {
      const { prisma } = await import('./db');
      const openTrades = await prisma.trade.findMany({
        where: { status: 'open' },
        select: {
          id: true, pair: true, type: true, entryPrice: true, volume: true,
          stopLoss: true, takeProfit: true, txid: true, createdAt: true,
          slOrderId: true, tpOrderId: true, closeTxid: true,
          expectedProfitUSD: true, expectedLossUSD: true, riskRewardRatio: true,
        },
      });

      if (openTrades.length === 0) return;

      logActivity.info(`🔄 Found ${openTrades.length} open trade(s) in DB — verifying with IB...`);

      const ib = createIBClient();
      let ibPositions: Awaited<ReturnType<typeof ib.getPositions>> = [];
      try {
        ibPositions = await ib.getPositions();
      } catch {
        logActivity.warning('Position recovery: cannot reach IB. Will retry on next update cycle.');
        return;
      }

      let recovered = 0;
      let markedClosed = 0;

      for (const trade of openTrades) {
        const ibPos = ibPositions.find(p => p.symbol === trade.pair && p.position > 0);

        if (ibPos) {
          // IB confirms shares are still held — restore to activePositions
          const posId = trade.txid ?? `${trade.pair}-${trade.id}`;
          const t = trade as any;
          this.activePositions.set(posId, {
            txid:              posId,
            pair:              trade.pair,
            type:              trade.type as 'buy' | 'sell',
            entryPrice:        trade.entryPrice,
            volume:            ibPos.position,
            stopLoss:          trade.stopLoss,
            takeProfit:        trade.takeProfit,
            currentPrice:      trade.entryPrice,
            pnl:               0,
            pnlPercent:        0,
            timestamp:         trade.createdAt.getTime(),
            dbTradeId:         trade.id,
            parentOrderId:     trade.txid ? (parseInt(trade.txid) || undefined) : undefined,
            slOrderId:         t.slOrderId         ?? undefined,
            tpOrderId:         t.tpOrderId         ?? undefined,
            expectedProfitUSD: t.expectedProfitUSD ?? undefined,
            expectedLossUSD:   t.expectedLossUSD   ?? undefined,
            riskRewardRatio:   t.riskRewardRatio   ?? undefined,
            partialTaken:      t.closeTxid === 'partial_taken',
          });
          recovered++;
          const slInfo     = t.slOrderId         ? ` | SL order #${t.slOrderId}` : '';
          const tpInfo     = t.tpOrderId         ? ` | TP order #${t.tpOrderId}` : '';
          const profitInfo = t.expectedProfitUSD ? ` | 🎯 Target: +$${t.expectedProfitUSD.toFixed(2)}` : '';
          const lossInfo   = t.expectedLossUSD   ? ` | 🛡️ Max loss: -$${t.expectedLossUSD.toFixed(2)}` : '';
          logActivity.info(`✅ Recovered: ${trade.pair} | ${ibPos.position} shares @ $${trade.entryPrice.toFixed(2)} | SL: $${trade.stopLoss.toFixed(2)}${slInfo} | TP: $${trade.takeProfit.toFixed(2)}${tpInfo}${profitInfo}${lossInfo}`);
        } else {
          // IB no longer holds shares — closed while bot was offline
          logActivity.warning(`⚠️ ${trade.pair} trade #${trade.id} not in IB positions — marking closed (offline close)`);
          await prisma.trade.update({
            where: { id: trade.id },
            data: {
              status:      'closed',
              closedAt:    new Date(),
              closeReason: 'closed_while_offline',
            },
          });
          markedClosed++;
        }
      }

      if (recovered > 0 || markedClosed > 0) {
        logActivity.info(`🔄 Recovery complete: ${recovered} position(s) restored, ${markedClosed} marked closed (offline)`);
        if (recovered > 0) {
          logActivity.info('ℹ️  Native IB bracket orders are still active — SL/TP protection is intact');
        }
      }
    } catch (err) {
      logActivity.error(`Position recovery failed: ${err}`);
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
      isRunning:          this.isRunning,
      config:             this.config,
      activePositions:    this.getActivePositions().length,
      lastHeartbeatAt:    this.lastHeartbeatAt || null,
      secondsSinceHeartbeat: this.lastHeartbeatAt
        ? Math.round((Date.now() - this.lastHeartbeatAt) / 1000)
        : null,
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
      log.debug('Portfolio snapshot skipped', { error: String(error) });
    }
  }
}

/**
 * Create a trading engine instance
 */
export function createTradingEngine(config?: Partial<TradingEngineConfig>): TradingEngine {
  return new TradingEngine(config);
}
