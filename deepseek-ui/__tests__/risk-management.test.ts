import { describe, it, expect, beforeEach } from "vitest";
import { RiskManager, createRiskManager, type Position, type PortfolioState } from "../lib/risk-management";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBuyPosition(overrides: Partial<Position> = {}): Position {
  return {
    pair: "AAPL",
    type: "buy",
    entryPrice: 100,
    volume: 10,
    stopLoss: 95,
    takeProfit: 110,
    currentPrice: 102,
    entryTime: Date.now() - 1000,
    highestPrice: 103,
    ...overrides,
  };
}

function makeSellPosition(overrides: Partial<Position> = {}): Position {
  return {
    pair: "AAPL",
    type: "sell",
    entryPrice: 100,
    volume: 10,
    stopLoss: 105,
    takeProfit: 90,
    currentPrice: 97,
    entryTime: Date.now() - 1000,
    lowestPrice: 96,
    ...overrides,
  };
}

// ─── RiskManager construction ─────────────────────────────────────────────────

describe("createRiskManager", () => {
  it("uses defaults when no params are provided", () => {
    const rm = createRiskManager();
    const p = rm.getParameters();
    expect(p.maxPositionSize).toBe(0.1);
    expect(p.maxPortfolioRisk).toBe(0.02);
    expect(p.stopLossPercent).toBe(0.05);
    expect(p.takeProfitPercent).toBe(0.10);
    expect(p.maxOpenPositions).toBe(3);
    expect(p.minConfidence).toBe(70);
  });

  it("accepts partial overrides", () => {
    const rm = createRiskManager({ stopLossPercent: 0.03, maxOpenPositions: 5 });
    const p = rm.getParameters();
    expect(p.stopLossPercent).toBe(0.03);
    expect(p.maxOpenPositions).toBe(5);
    expect(p.maxPortfolioRisk).toBe(0.02); // default unchanged
  });
});

// ─── calculateStopLoss / calculateTakeProfit ──────────────────────────────────

describe("calculateStopLoss", () => {
  const rm = new RiskManager({ stopLossPercent: 0.05 });

  it("BUY stop loss is below entry price", () => {
    expect(rm.calculateStopLoss(100, "buy")).toBeCloseTo(95);
  });

  it("SELL stop loss is above entry price", () => {
    expect(rm.calculateStopLoss(100, "sell")).toBeCloseTo(105);
  });
});

describe("calculateTakeProfit", () => {
  const rm = new RiskManager({ takeProfitPercent: 0.10 });

  it("BUY take profit is above entry price", () => {
    expect(rm.calculateTakeProfit(100, "buy")).toBeCloseTo(110);
  });

  it("SELL take profit is below entry price", () => {
    expect(rm.calculateTakeProfit(100, "sell")).toBeCloseTo(90);
  });
});

// ─── calculatePositionSize ────────────────────────────────────────────────────

describe("calculatePositionSize", () => {
  const rm = new RiskManager({ maxPortfolioRisk: 0.02, maxPositionSize: 0.10 });

  it("returns a positive number", () => {
    const size = rm.calculatePositionSize(10000, 100, 95);
    expect(size).toBeGreaterThan(0);
  });

  it("is bounded by max position size", () => {
    // Very tight stop loss → huge position by risk formula → capped at maxPositionSize
    const size = rm.calculatePositionSize(10000, 100, 99.99);
    const maxShares = (10000 * 0.10) / 100; // 10 shares
    expect(size).toBeLessThanOrEqual(maxShares);
  });

  it("is bounded by risk amount for wide stop loss", () => {
    // Wide stop: $20 risk per share, 2% of $10k = $200 max risk → 10 shares
    const size = rm.calculatePositionSize(10000, 100, 80);
    const riskBasedShares = (10000 * 0.02) / 20; // 10 shares
    expect(size).toBeLessThanOrEqual(riskBasedShares + 0.001);
  });
});

// ─── validateTrade ────────────────────────────────────────────────────────────

describe("validateTrade", () => {
  let rm: RiskManager;
  let portfolio: PortfolioState;

  beforeEach(() => {
    rm = new RiskManager({ minConfidence: 70, maxOpenPositions: 3 });
    portfolio = { totalValue: 10000, availableCash: 5000, positions: [] };
  });

  it("allows a valid trade", () => {
    const result = rm.validateTrade(portfolio, {
      type: "buy", pair: "AAPL", confidence: 80, entryPrice: 100,
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects low confidence", () => {
    const result = rm.validateTrade(portfolio, {
      type: "buy", pair: "AAPL", confidence: 60, entryPrice: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("60%");
  });

  it("rejects when max open positions reached", () => {
    portfolio.positions = [
      makeBuyPosition({ pair: "AAPL" }),
      makeBuyPosition({ pair: "MSFT" }),
      makeBuyPosition({ pair: "NVDA" }),
    ];
    const result = rm.validateTrade(portfolio, {
      type: "buy", pair: "TSLA", confidence: 80, entryPrice: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("3");
  });

  it("rejects duplicate position in same pair", () => {
    portfolio.positions = [makeBuyPosition({ pair: "AAPL" })];
    const result = rm.validateTrade(portfolio, {
      type: "buy", pair: "AAPL", confidence: 80, entryPrice: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("AAPL");
  });

  it("rejects when insufficient cash", () => {
    portfolio.availableCash = 1; // almost nothing
    const result = rm.validateTrade(portfolio, {
      type: "buy", pair: "AAPL", confidence: 80, entryPrice: 500,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Insufficient");
  });
});

// ─── shouldClosePosition ─────────────────────────────────────────────────────

describe("shouldClosePosition (BUY)", () => {
  const rm = new RiskManager();

  it("closes on stop loss", () => {
    const result = rm.shouldClosePosition(makeBuyPosition({ currentPrice: 94, stopLoss: 95 }));
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("stop-loss");
  });

  it("closes on take profit", () => {
    const result = rm.shouldClosePosition(makeBuyPosition({ currentPrice: 111, takeProfit: 110 }));
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("take-profit");
  });

  it("does not close when price is between SL and TP", () => {
    const result = rm.shouldClosePosition(makeBuyPosition({ currentPrice: 103 }));
    expect(result.shouldClose).toBe(false);
  });

  it("does not trigger trailing stop when profit < 15%", () => {
    // 14% profit — below the 15% threshold. Use a very high TP so partial-profit won't fire.
    const pos = makeBuyPosition({
      entryPrice: 100,
      currentPrice: 114,
      highestPrice: 130, // trailing stop = 117, price(114) < 117 but profit < 15% so no check
      stopLoss: 90,
      takeProfit: 300,   // targetProfitPercent=200% → 14% << 66% of 200% → no partial profit
    });
    expect(rm.shouldClosePosition(pos).shouldClose).toBe(false);
  });

  it("triggers trailing stop when profit >= 15% and price drops below trailing threshold", () => {
    // 16% profit, highestPrice=130 → trailingStop=117, currentPrice=116 < 117 → fires
    const pos = makeBuyPosition({
      entryPrice: 100,
      currentPrice: 116,
      highestPrice: 130,
      stopLoss: 90,
      takeProfit: 300, // far away — no partial profit (16% << 66% of 200%)
    });
    const result = rm.shouldClosePosition(pos);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("trailing-stop");
  });

  it("triggers time-based exit after 24h in profit", () => {
    const pos = makeBuyPosition({
      entryPrice: 100,
      currentPrice: 108, // 8% profit > 5%
      entryTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      stopLoss: 90,
      takeProfit: 120,
    });
    const result = rm.shouldClosePosition(pos);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("time-exit");
  });
});

describe("shouldClosePosition (SELL)", () => {
  const rm = new RiskManager();

  it("closes on stop loss (price rises above SL)", () => {
    const result = rm.shouldClosePosition(makeSellPosition({ currentPrice: 106, stopLoss: 105 }));
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("stop-loss");
  });

  it("closes on take profit (price falls below TP)", () => {
    const result = rm.shouldClosePosition(makeSellPosition({ currentPrice: 89, takeProfit: 90 }));
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("take-profit");
  });

  it("does not trigger trailing stop for short when profit < 15%", () => {
    // 11% profit — below threshold
    const pos = makeSellPosition({
      entryPrice: 100,
      currentPrice: 89,
      lowestPrice: 89,  // no rebound, so no partial-profit either
      stopLoss: 120,
      takeProfit: 50,
    });
    expect(rm.shouldClosePosition(pos).shouldClose).toBe(false);
  });

  it("triggers trailing stop for short when profit >= 15% and price rises above trailing threshold", () => {
    // entry=100, lowestPrice=70, trailingStop=70*1.10=77
    // currentPrice=78 (22% profit ≥15%) and 78 > 77 → fires
    const pos = makeSellPosition({
      entryPrice: 100,
      currentPrice: 78,
      lowestPrice: 70,
      stopLoss: 120,
      takeProfit: 50, // targetProfitPercent=50%, profitPercent=22% < 33% → no partial profit
    });
    const result = rm.shouldClosePosition(pos);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("trailing-stop");
  });
});

// ─── calculatePnL ─────────────────────────────────────────────────────────────

describe("calculatePnL", () => {
  const rm = new RiskManager();

  it("BUY position: positive PnL when price rises", () => {
    const { pnl, pnlPercent } = rm.calculatePnL(
      makeBuyPosition({ entryPrice: 100, currentPrice: 110, volume: 10 })
    );
    expect(pnl).toBeCloseTo(100);      // (110-100)*10
    expect(pnlPercent).toBeCloseTo(10); // 100 / (100*10) * 100
  });

  it("BUY position: negative PnL when price falls", () => {
    const { pnl } = rm.calculatePnL(
      makeBuyPosition({ entryPrice: 100, currentPrice: 90, volume: 5 })
    );
    expect(pnl).toBeCloseTo(-50);
  });

  it("SELL position: positive PnL when price falls", () => {
    const { pnl } = rm.calculatePnL(
      makeSellPosition({ entryPrice: 100, currentPrice: 90, volume: 10 })
    );
    expect(pnl).toBeCloseTo(100); // (100-90)*10
  });

  it("SELL position: negative PnL when price rises", () => {
    const { pnl } = rm.calculatePnL(
      makeSellPosition({ entryPrice: 100, currentPrice: 110, volume: 10 })
    );
    expect(pnl).toBeCloseTo(-100);
  });
});

// ─── calculatePortfolioRisk ───────────────────────────────────────────────────

describe("calculatePortfolioRisk", () => {
  const rm = new RiskManager();

  it("returns zero risk for empty portfolio", () => {
    const { totalRisk, totalRiskPercent, positionRisks } = rm.calculatePortfolioRisk({
      totalValue: 10000, availableCash: 10000, positions: [],
    });
    expect(totalRisk).toBe(0);
    expect(totalRiskPercent).toBe(0);
    expect(positionRisks).toHaveLength(0);
  });

  it("calculates risk for a single position", () => {
    const pos = makeBuyPosition({ entryPrice: 100, stopLoss: 95, volume: 10 });
    const portfolio = { totalValue: 10000, availableCash: 9000, positions: [pos] };
    const { totalRisk, totalRiskPercent, positionRisks } = rm.calculatePortfolioRisk(portfolio);
    expect(totalRisk).toBeCloseTo(50);        // |100-95| * 10
    expect(totalRiskPercent).toBeCloseTo(0.5); // 50/10000 * 100
    expect(positionRisks[0].pair).toBe("AAPL");
  });

  it("totalRiskPercent equals sum of individual risk percents", () => {
    const positions = [
      makeBuyPosition({ pair: "AAPL", entryPrice: 100, stopLoss: 95, volume: 10 }),
      makeSellPosition({ pair: "MSFT", entryPrice: 200, stopLoss: 210, volume: 5 }),
    ];
    const portfolio = { totalValue: 20000, availableCash: 15000, positions };
    const { totalRiskPercent, positionRisks } = rm.calculatePortfolioRisk(portfolio);
    const sumOfParts = positionRisks.reduce((s, p) => s + p.riskPercent, 0);
    expect(totalRiskPercent).toBeCloseTo(sumOfParts, 8);
  });
});
