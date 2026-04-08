/**
 * US Market Hours Utility
 * Single source of truth for market session detection (ET-based).
 * Includes NYSE holiday calendar computed algorithmically for any year.
 */

// ─── NYSE Holiday Calendar ────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD using its local year/month/day (no UTC shift). */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return the "observed" date for a fixed holiday:
 *   Saturday → previous Friday
 *   Sunday   → following Monday
 */
function observed(d: Date): Date {
  const day = d.getDay();
  if (day === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (day === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

/** Nth occurrence of a weekday (0=Sun…6=Sat) in a given month (1-based). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count++;
      if (count === n) return d;
    }
    d.setDate(d.getDate() + 1);
  }
}

/** Last occurrence of a weekday in a given month (1-based). */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month, 0); // last day of the month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}

/**
 * Easter Sunday via the Anonymous Gregorian algorithm.
 * Accurate for 1583–4099.
 */
function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Compute all NYSE observed holiday date strings (YYYY-MM-DD) for a year. */
function computeNYSEHolidays(year: number): Set<string> {
  const dates: Date[] = [
    // New Year's Day — Jan 1 (observed)
    observed(new Date(year, 0, 1)),
    // MLK Jr. Day — 3rd Monday of January
    nthWeekday(year, 1, 1, 3),
    // Presidents' Day — 3rd Monday of February
    nthWeekday(year, 2, 1, 3),
    // Good Friday — Friday before Easter
    (() => { const e = getEaster(year); return new Date(e.getFullYear(), e.getMonth(), e.getDate() - 2); })(),
    // Memorial Day — last Monday of May
    lastWeekday(year, 5, 1),
    // Juneteenth — Jun 19 (observed), NYSE holiday since 2022
    ...(year >= 2022 ? [observed(new Date(year, 5, 19))] : []),
    // Independence Day — Jul 4 (observed)
    observed(new Date(year, 6, 4)),
    // Labor Day — 1st Monday of September
    nthWeekday(year, 9, 1, 1),
    // Thanksgiving — 4th Thursday of November
    nthWeekday(year, 11, 4, 4),
    // Christmas — Dec 25 (observed)
    observed(new Date(year, 11, 25)),
  ];

  return new Set(dates.map(toDateStr));
}

// Cache per year — computed once, reused for the rest of the process lifetime
const _holidayCache = new Map<number, Set<string>>();

/** Returns true if the given ET date is an NYSE holiday. */
function isNYSEHoliday(etDate: Date): boolean {
  const year = etDate.getFullYear();
  if (!_holidayCache.has(year)) {
    _holidayCache.set(year, computeNYSEHolidays(year));
  }
  return _holidayCache.get(year)!.has(toDateStr(etDate));
}

// ─── Market Session ───────────────────────────────────────────────────────────

export interface MarketSession {
  isOpen: boolean;        // Regular trading hours only
  isWeekend: boolean;
  isHoliday: boolean;
  isPreMarket: boolean;
  isAfterHours: boolean;
  session: string;        // Human-readable label
  nextOpenMs: number;     // Ms until next regular session open (0 if already open)
}

export function getMarketSession(): MarketSession {
  const now   = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHour = etNow.getHours();
  const etMin  = etNow.getMinutes();
  const etDay  = etNow.getDay(); // 0=Sun, 6=Sat

  const isWeekend = etDay === 0 || etDay === 6;
  const isHoliday = !isWeekend && isNYSEHoliday(etNow);
  const closed    = isWeekend || isHoliday;

  const isPreMarket  = !closed && etHour >= 4 && (etHour < 9 || (etHour === 9 && etMin < 30));
  const isOpen       = !closed && (etHour > 9 || (etHour === 9 && etMin >= 30)) && etHour < 16;
  const isAfterHours = !closed && etHour >= 16 && etHour < 20;

  let session: string;
  if (isWeekend)        session = 'Weekend (market closed)';
  else if (isHoliday)   session = 'NYSE Holiday (market closed)';
  else if (isPreMarket) session = 'Pre-market (4:00–9:30 AM ET)';
  else if (isOpen)      session = 'Regular hours (9:30 AM–4:00 PM ET)';
  else if (isAfterHours)session = 'After-hours (4:00–8:00 PM ET)';
  else                  session = 'Market closed';

  // Calculate ms until next regular open (9:30 AM ET on next trading day)
  let nextOpenMs = 0;
  if (!isOpen) {
    const nextOpen = new Date(etNow.getFullYear(), etNow.getMonth(), etNow.getDate());

    if (isPreMarket) {
      // Same day at 9:30 AM
      nextOpen.setHours(9, 30, 0, 0);
    } else {
      // Advance to next day, skipping weekends and holidays
      nextOpen.setDate(nextOpen.getDate() + 1);
      while (
        nextOpen.getDay() === 0 ||
        nextOpen.getDay() === 6 ||
        isNYSEHoliday(nextOpen)
      ) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
      nextOpen.setHours(9, 30, 0, 0);
    }

    nextOpenMs = Math.max(0, nextOpen.getTime() - etNow.getTime());
  }

  return { isOpen, isWeekend, isHoliday, isPreMarket, isAfterHours, session, nextOpenMs };
}

export function isMarketOpen(): boolean {
  return getMarketSession().isOpen;
}
