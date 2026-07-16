import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import type { AbcClass } from "@/lib/shelflife";

export const dynamic = "force-dynamic";

// Per-product sales signal for the order screen:
//   d3/d7/d30 — units sold in the last 3 / 7 / 30 days (30d drives velocity)
//   dow       — units sold per weekday over the last 4 weeks (Mon..Sun)
//   abc       — ABC class by revenue over the last 90 days (A=top 80% of
//               revenue, B=next 15%, C=last 5%), the classic Pareto split
// The order builder uses this to show performance, classify importance, and
// recommend a shelf-life-capped quantity.
export async function GET() {
  const db = await readDB();
  const now = Date.now();
  const DAY = 86_400_000;

  type Row = { d3: number; d7: number; d30: number; dow: number[]; rev90: number; abc?: AbcClass };
  const map: Record<string, Row> = {};

  for (const sale of db.sales) {
    const t = new Date(sale.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    const ageDays = (now - t) / DAY;
    if (ageDays > 90) continue; // 90-day window feeds ABC; velocity uses subsets
    const jsDow = new Date(sale.createdAt).getDay(); // 0=Sun..6=Sat
    const dowIdx = (jsDow + 6) % 7; // Mon=0 .. Sun=6
    for (const it of sale.items) {
      let e = map[it.productId];
      if (!e) e = map[it.productId] = { d3: 0, d7: 0, d30: 0, dow: [0, 0, 0, 0, 0, 0, 0], rev90: 0 };
      if (ageDays <= 3) e.d3 += it.qty;
      if (ageDays <= 7) e.d7 += it.qty;
      if (ageDays <= 30) e.d30 += it.qty;
      if (ageDays <= 28) e.dow[dowIdx] += it.qty;
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
