/**
 * API Route Middleware
 *
 * Shared handler wrapper that:
 *   1. Sets up correlation ID (X-Request-ID header propagation)
 *   2. Catches unhandled errors and returns standardised { success: false } responses
 *   3. Logs errors consistently across all routes
 *
 * Usage:
 *   export async function GET(req: NextRequest) {
 *     return withHandler(req, 'api/my-route', async () => {
 *       // ... route logic ...
 *       return NextResponse.json({ success: true });
 *     });
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCorrelation } from './correlation';
import { apiError, type ErrorCode } from './api-response';
import { createLogger } from './logger';

const log = createLogger('api-middleware');

/**
 * Wrap a route handler with correlation ID + standardised error handling.
 *
 * @param req     The incoming NextRequest
 * @param context Logger context string (e.g. 'api/ib/health')
 * @param fn      The actual route handler function
 */
export function withHandler(
  req: NextRequest,
  context: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  return withCorrelation(req, async () => {
    try {
      return await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyError(error);
      const status = code === 'SERVICE_UNAVAILABLE' ? 503
        : code === 'NOT_FOUND'          ? 404
        : code === 'VALIDATION_ERROR'   ? 400
        : 500;

      // Only log server-side errors (4xx are caller mistakes, not our bug)
      if (status >= 500) {
        log.error(`Unhandled error in ${context}`, { error: message });
      } else {
        log.warn(`Client error in ${context}`, { status, error: message });
      }

      return apiError(message, code, { status });
    }
  });
}

/** Map common error patterns to ErrorCode for consistent API responses. */
function classifyError(error: unknown): ErrorCode {
  if (!(error instanceof Error)) return 'INTERNAL_ERROR';
  const msg = error.message.toLowerCase();
  if (msg.includes('connect') || msg.includes('econnrefused') || msg.includes('unreachable')) {
    return 'SERVICE_UNAVAILABLE';
  }
  if (msg.includes('not found') || msg.includes('no record')) return 'NOT_FOUND';
  if (msg.includes('prisma') || msg.includes('db_') || msg.includes('database')) return 'DB_ERROR';
  if (msg.includes('ib service') || msg.includes('ib_')) return 'IB_ERROR';
  return 'INTERNAL_ERROR';
}
