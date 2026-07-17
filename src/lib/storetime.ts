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

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A yyyy-mm-dd store date as "16 Jul".
 *
 * Read straight off the string rather than through `new Date(iso)`, which reads
 * a bare date as UTC midnight and then prints it in the VIEWER's timezone —
 * west of Greenwich that shows the day before, so a label's last selling day
 * would read a day early on a laptop set to New York.
 */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
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
