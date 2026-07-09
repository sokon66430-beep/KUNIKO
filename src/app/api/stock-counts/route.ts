import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isSameDay } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { StockCount } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  const list = [...db.stockCounts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json(list);
}

// Start (or continue) today's count. Same day → same report, even when a
// different user opens it — everyone's counts land in one shared count.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const session = await getSession();
  const who = String(body.countedBy || "").trim() || session?.name || "Counter";

  const result = await mutateDB((db) => {
    const now = new Date();
    const todays = db.stockCounts.find((c) => c.status === "Open" && isSameDay(new Date(c.createdAt), now));
    if (todays) return { count: todays, reused: true };

    const n = db.meta.nextStockCount++;
    const count: StockCount = {
      id: `sc${n}`,
      countNo: `SC-${n}`,
      status: "Open",
      countedBy: who,
      note: String(body.note || "").trim() || undefined,
      items: [],
      createdAt: now.toISOString(),
    };
    db.stockCounts.push(count);
    logAudit(db, { actor: who, action: "Started", entityType: "Count", entity: count.countNo });
    return { count, reused: false };
  });

  return NextResponse.json(result.count, { status: result.reused ? 200 : 201 });
}
