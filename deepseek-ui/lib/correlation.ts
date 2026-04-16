/**
 * Correlation ID — propagate a single request ID across the full async call stack.
 *
 * Usage in route handlers:
 *   import { withCorrelation } from '@/lib/correlation';
 *
 *   export async function GET(req: NextRequest) {
 *     return withCorrelation(req, async () => {
 *       // All log calls and IB fetch calls within here automatically include the ID
 *       const data = await fetchSomething();
 *       return NextResponse.json({ data });
 *     });
 *   }
 *
 * The logger reads the ID via getRequestId() — no changes needed in lib/ code.
 * The IB client forwards it as X-Request-ID on every outgoing request.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

const storage = new AsyncLocalStorage<string>();

/** Generate a short 8-character hex correlation ID */
export function generateRequestId(): string {
  try {
    return randomBytes(4).toString('hex');
  } catch {
    // Fallback for environments without crypto
    return Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Get the current request ID from async context.
 * Returns '-' when called outside of a withCorrelation() context.
 */
export function getRequestId(): string {
  return storage.getStore() ?? '-';
}

/**
 * Run fn within a correlation ID context derived from the incoming request.
 * Reads X-Request-ID header if present; otherwise generates a new ID.
 * The generated/extracted ID is available anywhere in the call stack via getRequestId().
 */
export function withCorrelation<T>(
  req: { headers: { get(name: string): string | null } },
  fn: () => T | Promise<T>,
): Promise<T> {
  const id = req.headers.get('x-request-id') ?? generateRequestId();
  return Promise.resolve(storage.run(id, fn));
}
