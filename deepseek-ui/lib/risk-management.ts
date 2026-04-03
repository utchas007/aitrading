/**
 * Risk Management Module for Trading Bot
 * Implements position sizing, stop-loss, and portfolio risk controls
 */

export interface RiskParameters {
  maxPositionSize: number; // Maximum % of portfolio per trade (e.g., 0.1 = 10%)
  maxPortfolioRisk: number; // Maximum % of portfolio at risk (e.g., 0.02 = 2%)
  stopLossPercent: number; // Stop loss % from entry (e.g., 0.05 = 5%)
  takeProfitPercent: number; // Take profit % from entry (e.g., 0.10 = 10%)
  maxOpenPositions: number; // Maximum number of concurrent positions
  minConfidence: number; // Minimum AI confidence to execute trade (0-100)
}

export interface Position {
  pair: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  volume: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  entryTime?: number; // Timestamp when position was opened
  highestPrice?: number; // Track highest price reached (for trailing)
}

export interface PortfolioState {
  totalValue: number; // Total portfolio value in USD
  availableCash: number; // Available cash for trading
  positions: Position[];
}

export class RiskManager {
  private params: RiskParameters;

  constructor(params: Partial<RiskParameters> = {}) {
    this.params = {
      maxPositionSize: params.maxPositionSize || 0.1, // 10% default
      maxPortfolioRisk: params.maxPortfolioRisk || 0.02, // 2% default
      stopLossPercent: params.stopLossPercent || 0.05, // 5% default
      takeProfitPercent: params.takeProfitPercent || 0.10, // 10% default
      maxOpenPositions: params.maxOpenPositions || 3,
      minConfidence: params.minConfidence || 70, // 70% confidence minimum
    };
  }

  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(
    portfolioValue: number,
    entryPrice: number,
    stopLossPrice: number
  ): number {
    // Calculate risk per share
    const riskPerShare = Math.abs(entryPrice - stopLossPrice);
    
    // Calculate maximum risk amount (2% of portfolio)
    const maxRiskAmount = portfolioValue * this.params.maxPortfolioRisk;
    
    // Calculate position size based on risk
    const positionSize = maxRiskAmount / riskPerShare;
    
    // Apply maximum position size constraint (10% of portfolio)
    const maxPositionValue = portfolioValue * this.params.maxPositionSize;
    const maxShares = maxPositionValue / entryPrice;
    
    return Math.min(positionSize, maxShares);
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(entryPrice: number, type: 'buy' | 'sell'): number {
    if (type === 'buy') {
      return entryPrice * (1 - this.params.stopLossPercent);
    } else {
      return entryPrice * (1 + this.params.stopLossPercent);
    }
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(entryPrice: number, type: 'buy' | 'sell'): number {
    if (type === 'buy') {
      return entryPrice * (1 + this.params.takeProfitPercent);
    } else {
      return entryPrice * (1 - this.params.takeProfitPercent);
    }
  }

  /**
   * Validate if trade should be executed based on risk parameters
   */
  validateTrade(
    portfolio: PortfolioState,
    signal: {
      type: 'buy' | 'sell';
      pair: string;
      confidence: number;
      entryPrice: number;
    }
  ): { allowed: boolean; reason?: string } {
    // Check confidence threshold
    if (signal.confidence < this.params.minConfidence) {
      return {
        allowed: false,
        reason: `Confidence ${signal.confidence}% below minimum ${this.params.minConfidence}%`,
      };
    }

    // Check maximum open positions
    if (portfolio.positions.length >= this.params.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Maximum open positions (${this.params.maxOpenPositions}) reached`,
      };
    }

    // Check if already have position in this pair
    const existingPosition = portfolio.positions.find(p => p.pair === signal.pair);
    if (existingPosition) {
      return {
        allowed: false,
        reason: `Already have open position in ${signal.pair}`,
      };
    }

    // Calculate required capital
    const stopLoss = this.calculateStopLoss(signal.entryPrice, signal.type);
    const positionSize = this.calculatePositionSize(
      portfolio.totalValue,
      signal.entryPrice,
      stopLoss
    );
    const requiredCapital = positionSize * signal.entryPrice;

    // Check available cash
    if (requiredCapital > portfolio.availableCash) {
      return {
        allowed: false,
        reason: `Insufficient funds. Required: $${requiredCapital.toFixed(2)}, Available: $${portfolio.availableCash.toFixed(2)}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if position should be closed with dynamic profit taking
   * Features:
   * - Partial profit taking at 50% of target if price reverses
   * - Time-based exits if position is open too long
   * - Trailing stop to lock in profits
   */
  shouldClosePosition(position: Position): {
    shouldClose: boolean;
    reason?: 'stop-loss' | 'take-profit' | 'partial-profit' | 'time-exit' | 'trailing-stop';
    partialClose?: boolean; // If true, close 50% of position
  } {
    const now = Date.now();
    const entryTime = position.entryTime || now;
    const timeInPosition = now - entryTime; // milliseconds
    const hoursInPosition = timeInPosition / (1000 * 60 * 60);
    
    // Track highest price for trailing stop
    const highestPrice = position.highestPrice || position.entryPrice;
    
    if (position.type === 'buy') {
      // Standard stop loss
      if (position.currentPrice <= position.stopLoss) {
        return { shouldClose: true, reason: 'stop-loss' };
      }
      
      // Full take profit at target
      if (position.currentPrice >= position.takeProfit) {
        return { shouldClose: true, reason: 'take-profit' };
      }
      
      // Calculate profit percentage
      const profitPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const targetProfitPercent = ((position.takeProfit - position.entryPrice) / position.entryPrice) * 100;
      
      // Partial profit taking: If reached 66% of target and price is reversing
      if (profitPercent >= targetProfitPercent * 0.66) {
        // Check if price dropped from highest by 5%
        const dropFromHigh = ((highestPrice - position.currentPrice) / highestPrice) * 100;
        if (dropFromHigh >= 5) {
          return { shouldClose: true, reason: 'partial-profit', partialClose: true };
        }
      }
      
      // Time-based exit: If position open > 24 hours and profitable
      if (hoursInPosition >= 24 && profitPercent > 5) {
        return { shouldClose: true, reason: 'time-exit', partialClose: profitPercent < targetProfitPercent };
      }
      
      // Trailing stop: If profit > 15%, set trailing stop at 10% below highest
      if (profitPercent >= 15) {
        const trailingStopPrice = highestPrice * 0.90; // 10% below highest
        if (position.currentPrice <= trailingStopPrice) {
          return { shouldClose: true, reason: 'trailing-stop' };
        }
      }
      
    } else {
      // SELL position logic (inverse)
      if (position.currentPrice >= position.stopLoss) {
        return { shouldClose: true, reason: 'stop-loss' };
      }
      
      if (position.currentPrice <= position.takeProfit) {
        return { shouldClose: true, reason: 'take-profit' };
      }
      
      const profitPercent = ((position.entryPrice - position.currentPrice) / position.entryPrice) * 100;
      const targetProfitPercent = ((position.entryPrice - position.takeProfit) / position.entryPrice) * 100;
      
      if (profitPercent >= targetProfitPercent * 0.66) {
        const riseFromLow = ((position.currentPrice - highestPrice) / highestPrice) * 100;
        if (riseFromLow >= 5) {
          return { shouldClose: true, reason: 'partial-profit', partialClose: true };
        }
      }
      
      if (hoursInPosition >= 24 && profitPercent > 5) {
        return { shouldClose: true, reason: 'time-exit', partialClose: profitPercent < targetProfitPercent };
      }
      
      if (profitPercent >= 15) {
        const trailingStopPrice = highestPrice * 1.10;
        if (position.currentPrice >= trailingStopPrice) {
          return { shouldClose: true, reason: 'trailing-stop' };
        }
      }
    }

    return { shouldClose: false };
  }

  /**
   * Calculate current profit/loss for a position
   */
  calculatePnL(position: Position): {
    pnl: number;
    pnlPercent: number;
  } {
    let pnl: number;
    if (position.type === 'buy') {
      pnl = (position.currentPrice - position.entryPrice) * position.volume;
    } else {
      pnl = (position.entryPrice - position.currentPrice) * position.volume;
    }

    const pnlPercent = (pnl / (position.entryPrice * position.volume)) * 100;

    return { pnl, pnlPercent };
  }

  /**
   * Calculate portfolio risk metrics
   */
  calculatePortfolioRisk(portfolio: PortfolioState): {
    totalRisk: number;
    totalRiskPercent: number;
    positionRisks: Array<{ pair: string; risk: number; riskPercent: number }>;
  } {
    const positionRisks = portfolio.positions.map(position => {
      const riskPerShare = Math.abs(position.entryPrice - position.stopLoss);
      const risk = riskPerShare * position.volume;
      const riskPercent = (risk / portfolio.totalValue) * 100;

      return {
        pair: position.pair,
        risk,
        riskPercent,
      };
    });

    const totalRisk = positionRisks.reduce((sum, p) => sum + p.risk, 0);
    const totalRiskPercent = (totalRisk / portfolio.totalValue) * 100;

    return {
      totalRisk,
      totalRiskPercent,
      positionRisks,
    };
  }

  /**
   * Get risk parameters
   */
  getParameters(): RiskParameters {
    return { ...this.params };
  }

  /**
   * Update risk parameters
   */
  updateParameters(params: Partial<RiskParameters>): void {
    this.params = { ...this.params, ...params };
  }
}

/**
 * Create a risk manager instance with default or custom parameters
 */
export function createRiskManager(params?: Partial<RiskParameters>): RiskManager {
  return new RiskManager(params);
}
