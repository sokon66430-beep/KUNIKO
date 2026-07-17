import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStats, type RangeKey } from "@/lib/analytics";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";

export const dynamic = "force-dynamic";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d"];

export async function GET(req: Request) {
  const db = await readDB();
  const raw = new URL(req.url).searchParams.get("range") as RangeKey | null;
  const range: RangeKey = raw && VALID.includes(raw) ? raw : "30d";
  const stats = buildStats(db, range);

  const session = await getSession();
  if (!session || canSeeProfit(session.role)) return NextResponse.json(stats);

  // Profit/margin/cost are restricted to Procurement + owner — zero them out
  // rather than send the real figures for every other role to inspect.
  return NextResponse.json({
    ...stats,
    profit: 0,
    cogs: 0,
    margin: 0,
    todayProfit: 0,
    series: stats.series.map((s) => ({ ...s, profit: 0 })),
    topProducts: stats.topProducts.map((p) => ({ ...p, profit: 0 })),
  });
}
