/**
 * Save a notification to the database.
 * Fire-and-forget — never blocks the caller.
 */
export function saveNotification(
  type: 'trade_executed' | 'trade_failed' | 'trade_closed' | 'ib_disconnected' | 'bot_stopped',
  title: string,
  message: string,
  pair?: string,
): void {
  fetch('http://localhost:3001/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, message, pair }),
  }).catch(() => {}); // never throws
}
