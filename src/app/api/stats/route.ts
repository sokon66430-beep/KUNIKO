import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStats, type RangeKey } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const VALID: RangeKey[] = ["today", "7d", "30d", "90d"];

export async function GET(req: Request) {
  const db = await readDB();
  const raw = new URL(req.url).searchParams.get("range") as RangeKey | null;
  const range: RangeKey = raw && VALID.includes(raw) ? raw : "30d";
  return NextResponse.json(buildStats(db, range));
}
