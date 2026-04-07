/**
 * US Market Hours Utility
 * Single source of truth for market session detection (ET-based)
 */

export interface MarketSession {
  isOpen: boolean;        // Regular trading hours only
  isWeekend: boolean;
  isPreMarket: boolean;
  isAfterHours: boolean;
  session: string;        // Human-readable label
  nextOpenMs: number;     // Ms until next regular session open (0 if already open)
}

export function getMarketSession(): MarketSession {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHour = etNow.getHours();
  const etMin  = etNow.getMinutes();
  const etDay  = etNow.getDay(); // 0=Sun, 6=Sat

  const isWeekend    = etDay === 0 || etDay === 6;
  const isPreMarket  = !isWeekend && etHour >= 4 && (etHour < 9 || (etHour === 9 && etMin < 30));
  const isOpen       = !isWeekend && (etHour > 9 || (etHour === 9 && etMin >= 30)) && etHour < 16;
  const isAfterHours = !isWeekend && etHour >= 16 && etHour < 20;

  let session: string;
  if (isWeekend)    session = 'Weekend (market closed)';
  else if (isPreMarket)  session = 'Pre-market (4:00–9:30 AM ET)';
  else if (isOpen)       session = 'Regular hours (9:30 AM–4:00 PM ET)';
  else if (isAfterHours) session = 'After-hours (4:00–8:00 PM ET)';
  else                   session = 'Market closed';

  // Calculate ms until next open (9:30 AM ET on next trading day)
  let nextOpenMs = 0;
  if (!isOpen) {
    const nextOpen = new Date(etNow);
    nextOpen.setSeconds(0, 0);

    if (isPreMarket) {
      // Same day, 9:30 AM
      nextOpen.setHours(9, 30, 0, 0);
    } else {
      // Next trading day 9:30 AM — skip weekends
      nextOpen.setDate(nextOpen.getDate() + 1);
      while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
      nextOpen.setHours(9, 30, 0, 0);
    }

    // Convert ET next open back to UTC diff
    const nextOpenUTC = new Date(nextOpen.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    nextOpenMs = Math.max(0, nextOpen.getTime() - etNow.getTime());
  }

  return { isOpen, isWeekend, isPreMarket, isAfterHours, session, nextOpenMs };
}

export function isMarketOpen(): boolean {
  return getMarketSession().isOpen;
}
