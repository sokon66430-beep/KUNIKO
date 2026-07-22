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

/** The hour of the day (0–23) in the store's timezone. */
export function storeHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: STORE_TZ, hour: "2-digit", hour12: false }).format(now);
  return Number(h) % 24; // hour12:false shows midnight as "24" in some engines
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

/**
 * How far the store's clock is ahead of UTC at a given instant, in ms.
 *
 * Read from the zone database rather than hard-coded to +7: Cambodia doesn't
 * use DST today, but a hard-coded offset is a silent landmine if that ever
 * changes or this is reused for a store elsewhere.
 */
function storeOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  // hour12:false renders midnight as "24" in some engines — %24 folds it back.
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - at.getTime();
}

/**
 * The real instant a wall-clock time in the shop happened.
 *
 * A POS report prints local time ("17/07/2026 10:30") while everything the
 * server records — a count's `countedAt`, a sale's `createdAt` — is a UTC
 * instant. Comparing the two as written would be out by the offset: a sale at
 * 10:30 local is 03:30 UTC, so a naive compare against a count taken at 10:00
 * local (03:00 UTC) would put the sale seven hours before a count it actually
 * came after. That's the difference between deducting it and not.
 *
 * Returns null unless both parts are a real date and a real HH:MM.
 */
export function storeInstant(day: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isValidTime(hhmm)) return null;
  const asIfUTC = Date.parse(`${day}T${hhmm}:00Z`);
  if (!isFinite(asIfUTC)) return null;
  // Read the offset AT that instant (not now), so a historical row is converted
  // with the rules that were in force on its own day.
  return new Date(asIfUTC - storeOffsetMs(new Date(asIfUTC)));
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
