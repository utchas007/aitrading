/**
 * Centralised Zod schemas for all POST request bodies.
 *
 * Each schema is exported individually and re-used in the corresponding
 * API route handler.  A shared `validate()` helper converts ZodError into
 * a standard { success: false, error, code: 'VALIDATION_ERROR' } response.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import type { ZodSchema, ZodError } from 'zod';

// ─── Sanitization helpers ────────────────────────────────────────────────────

/**
 * Strip HTML tags and control characters from a string.
 * Prevents script injection through news headlines.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')      // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .trim();
}

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Parse and validate `body` against `schema`.
 * Returns `{ data }` on success, `{ errorResponse }` on failure.
 *
 * Usage in route handlers:
 *   const parsed = validate(body, MySchema);
 *   if ('errorResponse' in parsed) return parsed.errorResponse;
 *   const { foo, bar } = parsed.data;
 */
export function validate<T>(
  body: unknown,
  schema: ZodSchema<T>,
): { data: T } | { errorResponse: NextResponse } {
  const result = schema.safeParse(body);
  if (result.success) return { data: result.data };

  const issues = (result.error as ZodError).issues.map((i) => ({
    field: i.path.join('.'),
    message: i.message,
  }));

  return {
    errorResponse: NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
        issues,
      },
      { status: 400 },
    ),
  };
}

// ─── Stock symbol format ───────────────────────────────────────────────────────

/**
 * US stock ticker: 1–5 uppercase letters (NYSE/NASDAQ).
 * Also accepts common ETF symbols like SPY, QQQ.
 */
export const stockSymbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol is required')
  .max(10, 'Symbol must be 10 characters or fewer')
  .transform((s) => s.toUpperCase());

// ─── Engine control ───────────────────────────────────────────────────────────

export const engineControlSchema = z.object({
  action: z.enum(['start', 'stop', 'restart'], {
    errorMap: () => ({ message: 'action must be one of: start | stop | restart' }),
  }),
  config: z
    .object({
      pairs: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(10)
            .transform((s) => s.toUpperCase()),
        )
        .min(1, 'At least one trading pair required')
        .max(20, 'Too many pairs (max 20)')
        .optional(),
      minConfidence: z
        .number()
        .int()
        .min(0, 'minConfidence must be 0–100')
        .max(100, 'minConfidence must be 0–100')
        .optional(),
      maxPositions: z
        .number()
        .int()
        .min(1, 'maxPositions must be at least 1')
        .max(50, 'maxPositions must be 50 or fewer')
        .optional(),
      riskPerTrade: z
        .number()
        .min(0.001, 'riskPerTrade must be > 0')
        .max(0.5, 'riskPerTrade must be ≤ 0.5 (50%) — max allowed: 50%')
        .optional(),
      stopLossPercent: z
        .number()
        .min(0.001, 'stopLossPercent must be > 0')
        .max(0.5, 'stopLossPercent must be ≤ 0.5 (50%)')
        .optional(),
      takeProfitPercent: z
        .number()
        .min(0.001, 'takeProfitPercent must be > 0')
        .max(2.0, 'takeProfitPercent must be ≤ 2.0 (200%)')
        .optional(),
      checkInterval: z
        .number()
        .int()
        .min(30_000, 'checkInterval must be at least 30 seconds (30000 ms)')
        .max(3_600_000, 'checkInterval must be ≤ 1 hour (3600000 ms)')
        .optional(),
      autoExecute: z.boolean().optional(),
      tradeCooldownHours: z
        .number()
        .min(0)
        .max(168, 'tradeCooldownHours must be ≤ 168 (1 week)')
        .optional(),
      maxDailyTrades: z
        .number()
        .int()
        .min(0)
        .max(200, 'maxDailyTrades must be ≤ 200')
        .optional(),
    })
    .optional(),
});

export type EngineControlBody = z.infer<typeof engineControlSchema>;

// ─── Trading analysis ─────────────────────────────────────────────────────────

export const tradingAnalysisSchema = z.object({
  pair: stockSymbolSchema,
  news: z
    .array(
      z.object({
        title:       z.string().min(1).max(500).trim().transform(sanitizeText),
        description: z.string().max(2000).trim().transform(sanitizeText).default(''),
        source:      z.string().max(100).trim().default(''),
        pubDate:     z.string().max(100).trim().default(''),
      }),
    )
    .max(50, 'Too many news items (max 50)'),
  marketData: z.record(
    z.object({
      price:     z.string(),
      volume:    z.string(),
      change24h: z.string().optional(),
    }),
  ),
  assetType:    z.enum(['crypto', 'stock']).optional(),
  technicals:   z.object({
    rsi:          z.number().min(0).max(100).optional(),
    rsiSignal:    z.string().max(20).optional(),
    macd:         z.string().max(20).optional(),
    overallSignal: z.string().max(20).optional(),
    confidence:   z.number().min(0).max(100).optional(),
    price:        z.number().min(0).optional(),
    change:       z.string().max(20).optional(),
  }).optional(),
  worldContext: z.string().max(5000).optional(),
});

export type TradingAnalysisBody = z.infer<typeof tradingAnalysisSchema>;

// ─── Notification ─────────────────────────────────────────────────────────────

export const createNotificationSchema = z.object({
  type:    z.string().min(1, 'type is required').max(50),
  title:   z.string().min(1, 'title is required').max(200).trim(),
  message: z.string().min(1, 'message is required').max(1000).trim(),
  pair:    z.string().max(20).trim().optional(),
});

export const markNotificationSchema = z.union([
  z.object({ action: z.literal('markAllRead') }),
  z.object({ action: z.literal('markRead'), id: z.number().int().positive() }),
  createNotificationSchema,
]);

export type NotificationBody = z.infer<typeof markNotificationSchema>;

// ─── Portfolio snapshot ───────────────────────────────────────────────────────

// Portfolio snapshot POST has no required body fields — empty object is valid
export const portfolioSnapshotSchema = z.object({}).passthrough();

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const chatMessageSchema = z.object({
  message:        z.string().min(1, 'message is required').max(10000, 'message too long (max 10,000 chars)').trim(),
  conversationId: z.number().int().positive().optional(),
  model:          z.string().max(100).optional(),
});

export type ChatMessageBody = z.infer<typeof chatMessageSchema>;
