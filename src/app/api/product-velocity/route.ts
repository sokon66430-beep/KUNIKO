import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { storeToday } from "@/lib/storetime";
import type { AbcClass } from "@/lib/shelflife";

export const dynamic = "force-dynamic";

// Per-product sales signal for the order screen:
//   d3/d7/d30 — units sold in the last 3 / 7 / 30 days (30d drives velocity)
//   last7     — units sold on each of the last 7 store-calendar days, oldest →
//               newest (the last entry is today). A rolling window, not a fixed
//               Mon..Sun week, so the buyer sees "the last 7 days" ending now.
//   abc       — ABC class by revenue over the last 90 days (A=top 80% of
//               revenue, B=next 15%, C=last 5%), the classic Pareto split
// The order builder uses this to show performance, classify importance, and
// recommend a shelf-life-capped quantity. The response carries `days` (the 7
// yyyy-mm-dd keys) alongside the per-product map so the client can label each
// bar with the correct weekday without re-deriving "today".
export async function GET() {
  const db = await readDB();
  const now = Date.now();
  const DAY = 86_400_000;

  // The last 7 store-calendar days, oldest → newest (newest = today in the
  // shop's timezone). Sales are bucketed by their store day, not by a raw
  // 24-hour age, so each bar lines up with a real calendar date.
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(storeToday(new Date(now - i * DAY)));
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  type Row = { d3: number; d7: number; d30: number; last7: number[]; rev90: number; abc?: AbcClass };
  const map: Record<string, Row> = {};

  for (const sale of db.sales) {
    if (sale.cancelled) continue; // voided invoices aren't real demand
    const t = new Date(sale.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    const ageDays = (now - t) / DAY;
    if (ageDays > 90) continue; // 90-day window feeds ABC; velocity uses subsets
    const dayIdx = dayIndex.get(storeToday(new Date(t)));
    for (const it of sale.items) {
      let e = map[it.productId];
      if (!e) e = map[it.productId] = { d3: 0, d7: 0, d30: 0, last7: [0, 0, 0, 0, 0, 0, 0], rev90: 0 };
      if (ageDays <= 3) e.d3 += it.qty;
      if (ageDays <= 7) e.d7 += it.qty;
      if (ageDays <= 30) e.d30 += it.qty;
      if (dayIdx !== undefined) e.last7[dayIdx] += it.qty;
      e.rev90 += it.price * it.qty; // revenue over the 90-day window
    }
  }

  // ABC by cumulative revenue share (Pareto 80/15/5).
  const rows = Object.values(map);
  const totalRev = rows.reduce((s, r) => s + r.rev90, 0);
  if (totalRev > 0) {
    const sorted = [...rows].sort((a, b) => b.rev90 - a.rev90);
    let cum = 0;
    for (const r of sorted) {
      cum += r.rev90;
      const share = cum / totalRev;
      r.abc = share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C";
    }
  }

  return NextResponse.json(map);
}
