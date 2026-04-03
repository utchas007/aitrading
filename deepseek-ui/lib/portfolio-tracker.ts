/**
 * Portfolio Tracker
 * Tracks portfolio balance over time using JSON file storage
 */

import fs from 'fs';
import path from 'path';

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
  assets: {
    [currency: string]: {
      amount: number;
      value: number;
    };
  };
  trades: number; // Total number of trades executed
  pnl: number; // Profit/Loss since start
  pnlPercent: number; // P&L percentage
}

const DATA_DIR = path.join(process.cwd(), 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio-history.json');

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load portfolio history from JSON file
 */
export function loadPortfolioHistory(): PortfolioSnapshot[] {
  ensureDataDir();
  
  if (!fs.existsSync(PORTFOLIO_FILE)) {
    return [];
  }

  try {
    const data = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading portfolio history:', error);
    return [];
  }
}

/**
 * Save portfolio snapshot to JSON file
 */
export function savePortfolioSnapshot(snapshot: PortfolioSnapshot): void {
  ensureDataDir();
  
  const history = loadPortfolioHistory();
  history.push(snapshot);
  
  // Keep only last 1000 snapshots to prevent file from growing too large
  const trimmedHistory = history.slice(-1000);
  
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(trimmedHistory, null, 2));
}

/**
 * Get portfolio history for a specific time range
 */
export function getPortfolioHistory(
  startTime?: number,
  endTime?: number
): PortfolioSnapshot[] {
  const history = loadPortfolioHistory();
  
  if (!startTime && !endTime) {
    return history;
  }
  
  return history.filter(snapshot => {
    if (startTime && snapshot.timestamp < startTime) return false;
    if (endTime && snapshot.timestamp > endTime) return false;
    return true;
  });
}

/**
 * Get latest portfolio snapshot
 */
export function getLatestSnapshot(): PortfolioSnapshot | null {
  const history = loadPortfolioHistory();
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Calculate portfolio statistics
 */
export function getPortfolioStats(): {
  currentValue: number;
  initialValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  highestValue: number;
  lowestValue: number;
  totalSnapshots: number;
} {
  const history = loadPortfolioHistory();
  
  if (history.length === 0) {
    return {
      currentValue: 0,
      initialValue: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      highestValue: 0,
      lowestValue: 0,
      totalSnapshots: 0,
    };
  }
  
  const initialValue = history[0].totalValue;
  const currentValue = history[history.length - 1].totalValue;
  const totalPnL = currentValue - initialValue;
  const totalPnLPercent = (totalPnL / initialValue) * 100;
  
  const values = history.map(s => s.totalValue);
  const highestValue = Math.max(...values);
  const lowestValue = Math.min(...values);
  
  return {
    currentValue,
    initialValue,
    totalPnL,
    totalPnLPercent,
    highestValue,
    lowestValue,
    totalSnapshots: history.length,
  };
}

/**
 * Clear portfolio history (use with caution!)
 */
export function clearPortfolioHistory(): void {
  ensureDataDir();
  
  if (fs.existsSync(PORTFOLIO_FILE)) {
    fs.unlinkSync(PORTFOLIO_FILE);
  }
}
