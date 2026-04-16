/**
 * Structured logger for the trading bot.
 *
 * Dev  (NODE_ENV !== 'production'):  human-readable  [HH:MM:SS.mmm] LEVEL [context] message {meta}
 * Prod (NODE_ENV === 'production'):  JSON one-liner   {"level":"info","time":"...","context":"...","msg":"..."}
 *
 * Log level is controlled by the LOG_LEVEL environment variable (default: "info").
 * Valid values: debug | info | warn | error
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('ib-client');
 *   log.info('Connected', { accounts: ['DU12345'] });
 *   log.error('Request failed', { error: err.message, path: '/balance' });
 */

import { getRequestId } from './correlation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_RANK));
const _rawLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
if (process.env.LOG_LEVEL && !VALID_LEVELS.has(_rawLevel)) {
  // Emit directly to stderr so this warning is always visible regardless of level
  console.warn(
    `[logger] Invalid LOG_LEVEL "${process.env.LOG_LEVEL}" — ` +
    `valid values: ${[...VALID_LEVELS].join(' | ')}. Defaulting to "info".`,
  );
}
const MIN_LEVEL: number = LEVEL_RANK[(_rawLevel as LogLevel)] ?? LEVEL_RANK.info;

/** The effective minimum log level (resolved from LOG_LEVEL env var). */
export const effectiveLogLevel = _rawLevel as LogLevel;

const IS_PROD = process.env.NODE_ENV === 'production';

function emit(
  level: LogLevel,
  context: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (LEVEL_RANK[level] < MIN_LEVEL) return;

  const consoleFn =
    level === 'error' ? console.error
    : level === 'warn'  ? console.warn
    : console.log;

  const reqId = getRequestId();

  if (IS_PROD) {
    // JSON — easy to ingest by log aggregators / grep
    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      context,
      ...(reqId !== '-' ? { reqId } : {}),
      msg: message,
    };
    if (meta) Object.assign(entry, meta);
    consoleFn(JSON.stringify(entry));
  } else {
    // Human-readable for local development
    const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const levelTag = level.toUpperCase().padEnd(5);
    const reqStr = reqId !== '-' ? ` [${reqId}]` : '';
    const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    consoleFn(`[${time}] ${levelTag} [${context}]${reqStr} ${message}${metaStr}`);
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info (message: string, meta?: Record<string, unknown>): void;
  warn (message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a logger scoped to a specific module/context.
 * @param context  Short identifier shown in every log line, e.g. 'ib-client', 'trading-engine'
 */
export function createLogger(context: string): Logger {
  return {
    debug: (msg, meta) => emit('debug', context, msg, meta),
    info:  (msg, meta) => emit('info',  context, msg, meta),
    warn:  (msg, meta) => emit('warn',  context, msg, meta),
    error: (msg, meta) => emit('error', context, msg, meta),
  };
}
