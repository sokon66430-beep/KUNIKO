import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { QueueTicket, Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

// Read the store's pickup-number queue.
//   GET /api/queue            → current counter + recent tickets (newest first)
//   GET /api/queue?number=25  → tickets that carry number 025 (search), newest
//                               first, each with its receipt, items and time
// Any signed-in till user can read this (cashiers view the current number and
// search); the reset and cancel actions live on their own owner-/supervisor-
// gated routes.
function view(t: QueueTicket, saleById: Map<string, Sale>) {
  const sale = saleById.get(t.saleId);
  return {
    id: t.id,
    number: t.number,
    receiptNo: t.receiptNo,
    posTerminalId: t.posTerminalId ?? null,
    cashier: t.cashier,
    status: t.status,
    createdAt: t.createdAt,
    cancelledAt: t.cancelledAt ?? null,
    total: sale?.total ?? null,
    items: sale ? sale.items.map((it) => ({ name: it.name, qty: it.qty })) : [],
  };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = await readDB();
  const saleById = new Map(db.sales.map((s) => [s.id, s]));
  const url = new URL(req.url);
  const numberParam = url.searchParams.get("number");

  // Newest first throughout.
  const ordered = [...db.queue].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (numberParam != null && numberParam.trim() !== "") {
    // Accept "25" or "025". Numbers cycle, so a search can match several tickets
    // over time — return them all, newest first, so the operator picks the live
    // one by its receipt/time.
    const n = Number(numberParam.replace(/\D/g, ""));
    const matches = Number.isFinite(n) && n >= 1 && n <= 99 ? ordered.filter((t) => t.number === n) : [];
    return NextResponse.json({
      query: numberParam,
      matches: matches.slice(0, 50).map((t) => view(t, saleById)),
    });
  }

  return NextResponse.json({
    current: db.meta.queue?.current ?? 0,
    updatedAt: db.meta.queue?.updatedAt ?? null,
    recent: ordered.slice(0, 50).map((t) => view(t, saleById)),
  });
}
