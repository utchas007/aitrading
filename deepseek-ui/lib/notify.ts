/**
 * Save a notification to the database.
 * Fire-and-forget — never blocks the caller.
 *
 * Uses NEXTJS_URL env var (set by docker-compose to http://nextjs:3000) so
 * the bot container can reach the Next.js API. Falls back to localhost:3001
 * for direct host runs.
 */
const _NEXTJS_BASE = (process.env.NEXTJS_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export function saveNotification(
  type: 'trade_executed' | 'trade_failed' | 'trade_closed' | 'ib_disconnected' | 'bot_stopped',
  title: string,
  message: string,
  pair?: string,
): void {
  fetch(`${_NEXTJS_BASE}/api/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, message, pair }),
  }).catch(() => {}); // never throws
}
