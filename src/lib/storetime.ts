// ---------------------------------------------------------------------------
// The store's clock
//
// The shop runs on Phnom Penh time while the server runs on UTC. Anything that
// decides "is this deal on right now" has to ask in the store's own zone —
// otherwise a promotion ends at 5pm local on its last day (UTC midnight), or a
// happy hour set for 17:00–19:00 fires at lunchtime.
//
// One definition, imported everywhere, so two features can never disagree about
// what day or what time it is in the shop.
// ---------------------------------------------------------------------------

export const STORE_TZ = "Asia/Phnom_Penh";

/** Today's calendar date in the store's timezone, as yyyy-mm-dd. */
export function storeToday(now: Date = new Date()): string {
  // en-CA formats as yyyy-mm-dd, which sorts and compares as plain text.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The wall-clock time in the shop right now, as "HH:MM" on a 24-hour clock. */
export function storeTimeHHMM(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: STORE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** "HH:MM" — anything else (including 24:00 and 9:5) is not a time. */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/**
 * Is `time` inside a daily window? Both ends are inclusive.
 *
 * A window that ends before it starts (22:00–02:00) is an OVERNIGHT window, not
 * an error — a late-night deal is a normal thing for a convenience store, so it
 * wraps past midnight rather than matching nothing.
 */
export function withinDailyWindow(time: string, start?: string, end?: string): boolean {
  if (!start || !end) return true; // no window set = all day
  if (start <= end) return time >= start && time <= end;
  return time >= start || time <= end; // wraps midnight
}
