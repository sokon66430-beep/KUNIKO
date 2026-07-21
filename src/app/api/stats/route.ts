import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStats, type RangeKey } from "@/lib/analytics";
import { getSession } from "@/lib/session";
import { profitFor } from "@/lib/caps";

export const dynamic = "force-dynamic";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d"];

export async function GET(req: Request) {
  const db = await readDB();
  const params = new URL(req.url).searchParams;
  const raw = params.get("range") as RangeKey | null;
  const range: RangeKey = raw && VALID.includes(raw) ? raw : "30d";
  // A specific day picked from the calendar overrides the preset range; an
  // optional `to` date extends it into an inclusive from–to window.
  const valid = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const customDay = valid(params.get("date"));
  const customTo = valid(params.get("to"));
  const stats = buildStats(db, range, customDay, customTo);

  const session = await getSession();
  if (!session || (await profitFor(session.role))) return NextResponse.json(stats);

  // Profit/margin/cost are restricted to Procurement + owner — zero them out
  // rather than send the real figures for every other role to inspect.
  return NextResponse.json({
    ...stats,
    profit: 0,
    cogs: 0,
    margin: 0,
    todayProfit: 0,
    series: stats.series.map((s) => ({ ...s, profit: 0 })),
    // Cost and profit are the sensitive columns; VAT / revenue / qty stay.
    topProducts: stats.topProducts.map((p) => ({ ...p, cost: 0, profit: 0, margin: 0 })),
    productReport: stats.productReport.map((p) => ({ ...p, cost: 0, profit: 0, margin: 0 })),
  });
}
