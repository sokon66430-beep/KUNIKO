import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// Sales velocity per product, for the order screen:
//   d3  — units sold in the last 3 days
//   d7  — units sold in the last 7 days
//   dow — units sold per weekday over the last 4 weeks, Monday..Sunday
// The order builder uses this to show performance and recommend a quantity.
export async function GET() {
  const db = await readDB();
  const now = Date.now();
  const DAY = 86_400_000;
  const map: Record<string, { d3: number; d7: number; dow: number[] }> = {};

  for (const sale of db.sales) {
    const t = new Date(sale.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    const ageDays = (now - t) / DAY;
    if (ageDays > 28) continue; // only the last 4 weeks feed the weekday pattern
    const jsDow = new Date(sale.createdAt).getDay(); // 0=Sun..6=Sat
    const dowIdx = (jsDow + 6) % 7; // Mon=0 .. Sun=6
    for (const it of sale.items) {
      let e = map[it.productId];
      if (!e) e = map[it.productId] = { d3: 0, d7: 0, dow: [0, 0, 0, 0, 0, 0, 0] };
      if (ageDays <= 3) e.d3 += it.qty;
      if (ageDays <= 7) e.d7 += it.qty;
      e.dow[dowIdx] += it.qty;
    }
  }

  return NextResponse.json(map);
}
