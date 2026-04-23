/**
 * Shared trading constants used across the bot.
 *
 * All magic numbers that appear in multiple files should live here.
 * Import and use instead of scattering literal values throughout the codebase.
 */

// ─── Default trading engine config ───────────────────────────────────────────

/** Minimum AI confidence score (0–100) required to act on a signal. */
export const DEFAULT_MIN_CONFIDENCE = 75;

/** Maximum number of concurrent open positions. */
export const DEFAULT_MAX_POSITIONS = 6;

/** Fraction of available cash to risk per trade (e.g. 0.10 = 10%). */
export const DEFAULT_RISK_PER_TRADE = 0.10;

/** Stop-loss distance from entry as a fraction (e.g. 0.05 = 5%). */
export const DEFAULT_STOP_LOSS_PERCENT = 0.05;

/** Take-profit distance from entry as a fraction (e.g. 0.10 = 10%). */
export const DEFAULT_TAKE_PROFIT_PERCENT = 0.10;

/** Profit % at which half the position is sold to lock in gains (e.g. 0.05 = 5%). */
export const DEFAULT_PARTIAL_PROFIT_PERCENT = 0.05;

/** Profit % at which the trailing stop activates (e.g. 0.07 = 7%). */
export const DEFAULT_TRAILING_ACTIVATION_PERCENT = 0.07;

/** How far the trailing stop trails below the highest price (e.g. 0.03 = 3%). */
export const DEFAULT_TRAILING_STOP_PERCENT = 0.03;

/** Market check interval in milliseconds (default: 2 minutes). */
export const DEFAULT_CHECK_INTERVAL_MS = 2 * 60 * 1000;

/** Maximum trades per calendar day. */
export const DEFAULT_MAX_DAILY_TRADES = 30;

/** Hours before the same pair can be traded again. */
export const DEFAULT_TRADE_COOLDOWN_HOURS = 1;

// ─── IB order defaults ────────────────────────────────────────────────────────

/**
 * Limit order slippage buffer: entry limit is placed this % above/below
 * the signal price to prevent overpaying if the stock gaps overnight.
 */
export const ENTRY_LIMIT_SLIPPAGE = 0.005; // 0.5%

// ─── Position sizing ──────────────────────────────────────────────────────────

/** Maximum fraction of account value in a single position. */
export const MAX_POSITION_FRACTION = 0.05; // 5%

/** ATR multiplier for stop-loss placement (stop = price - ATR × SL_ATR_MULT). */
export const SL_ATR_MULTIPLIER = 1.5;

/** ATR multiplier for take-profit placement (tp = price + ATR × TP_ATR_MULT). */
export const TP_ATR_MULTIPLIER = 2.0;

/** IBKR Canada: minimum fee per order (CAD). */
export const IB_MIN_FEE_CAD = 1.0;

/** IBKR Canada: fee per share (CAD). */
export const IB_FEE_PER_SHARE_CAD = 0.01;

/** IBKR Canada: max fee as fraction of trade value (capped at 0.5%). */
export const IB_MAX_FEE_FRACTION = 0.005;

/** Minimum expected profit buffer above round-trip fees (×3 = safety margin). */
export const MIN_PROFIT_FEE_MULTIPLIER = 3;

// ─── VIX thresholds ───────────────────────────────────────────────────────────

export const VIX_LOW_THRESHOLD      = 15;  // below: low volatility, full size
export const VIX_ELEVATED_THRESHOLD = 25;  // below: elevated, 75% size
export const VIX_HIGH_THRESHOLD     = 35;  // below: high, 50% size; above: blocked

export const VIX_ELEVATED_SIZE_MULT = 0.75;
export const VIX_HIGH_SIZE_MULT     = 0.50;
export const VIX_EXTREME_SIZE_MULT  = 0.0;

// ─── Earnings blackout ────────────────────────────────────────────────────────

/** Trade blocked within this many days of earnings. */
export const EARNINGS_AVOID_DAYS   = 2;

/** Reduce position size within this many days of earnings. */
export const EARNINGS_CAUTION_DAYS = 7;

/** Size multiplier when earnings are in the caution window. */
export const EARNINGS_CAUTION_SIZE_MULT = 0.5;

// ─── Signal logic weights ─────────────────────────────────────────────────────

/** Weight of technical signals when blending with AI analysis (0–1). */
export const TECHNICAL_WEIGHT = 0.6;

/** Weight of AI sentiment when blending with technical signals (0–1). */
export const AI_WEIGHT = 0.4;

/** Minimum AI confidence for AI-only signals (no strong technical). */
export const AI_ONLY_MIN_CONFIDENCE = 70;

/** Confidence boost when technicals and AI agree on direction. */
export const AGREEMENT_CONFIDENCE_BOOST = 10;

// ─── Micro-filter thresholds ──────────────────────────────────────────────────

/** Volume must be at least this multiple of the average to confirm a signal. */
export const VOLUME_CONFIRMATION_RATIO = 1.3;

/**
 * BB-below: RSI must be below this to confirm a valid long entry.
 * (price below lower band alone is not enough without oversold RSI)
 */
export const BB_BELOW_RSI_MAX = 40;

/**
 * BB-above: RSI must be above this to confirm a valid short entry.
 */
export const BB_ABOVE_RSI_MIN = 60;

/** VIX level above which MACD histogram must be positive to allow trades. */
export const ELEVATED_VIX_MACD_THRESHOLD = 22;

// ─── Sentiment scoring ────────────────────────────────────────────────────────

/** Bearish sentiment penalty applied to BUY confidence (percentage points). */
export const BEARISH_SENTIMENT_CONFIDENCE_PENALTY = 15;

/** Overall score threshold above which sentiment is classified as Bullish. */
export const BULLISH_SCORE_THRESHOLD = 20;

/** Overall score threshold below which sentiment is classified as Bearish. */
export const BEARISH_SCORE_THRESHOLD = -20;

// ─── ActivityLog / DB ─────────────────────────────────────────────────────────

/** Default ActivityLog retention period in days (rows older than this are deleted). */
export const ACTIVITY_LOG_RETENTION_DAYS = 90;

// ─── IB recovery ─────────────────────────────────────────────────────────────

/** Number of consecutive IB health check failures before the engine stops. */
export const MAX_IB_FAILURE_COUNT = 3;
