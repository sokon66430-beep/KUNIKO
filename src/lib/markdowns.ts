import type { Markdown } from "./types";
import { storeToday } from "./storetime";

// The store clock now lives in lib/storetime (promotions need the time of day
// too, and one shop can't have two ideas of what day it is). Re-exported here
// so the many callers that already import it from this module keep working.
export { storeToday };

// ---------------------------------------------------------------------------
// Markdowns — the "reduced to clear" label. A product is registered for a cut
// (30/50/70%) with a last selling day; the system mints a barcode for it, the
// label goes on the physical items, and the till sells THOSE at the cut price
// while the rest of the shelf stays full price. The label stops scanning by
// itself the day after it ends.
//
// Everything here is derived from the dates — no scheduled job flips a flag, so
// a promo can never be left switched on because a cron didn't run.
// ---------------------------------------------------------------------------

export const MARKDOWN_PERCENTS = [30, 50, 70];

// In-store namespace for generated codes. No ON Mart barcode starts with 92, so
// a promo code can never collide with a real product's barcode.
const PROMO_PREFIX = "92";

/** `92` + 7-digit sequence — 9 numeric digits, scans as CODE128 like the rest. */
export function markdownCode(seq: number): string {
  return PROMO_PREFIX + String(seq).padStart(7, "0");
}

export function isMarkdownCode(code: string): boolean {
  return /^92\d{7}$/.test(code.trim());
}

/** The discounted shelf price, to the cent. */
export function markdownPrice(originalPrice: number, percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  return Math.round(originalPrice * (1 - p / 100) * 100) / 100;
}

export type MarkdownStatus = "Scheduled" | "Active" | "Expired" | "Cancelled";

export function markdownStatus(m: Markdown, today: string = storeToday()): MarkdownStatus {
  if (m.cancelledAt) return "Cancelled";
  if (today < m.startDate) return "Scheduled";
  if (today > m.endDate) return "Expired"; // endDate is the LAST selling day
  return "Active";
}

/** Only an Active label may be rung up. */
export function isSellable(m: Markdown, today: string = storeToday()): boolean {
  return markdownStatus(m, today) === "Active";
}

/** Days left including today — 0 means today is the last day. */
export function daysLeft(m: Markdown, today: string = storeToday()): number {
  const ms = Date.parse(m.endDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z");
  return Math.round(ms / 86400000);
}

export function findByCode(list: Markdown[], code: string): Markdown | undefined {
  const q = code.trim();
  return list.find((m) => m.code === q);
}
