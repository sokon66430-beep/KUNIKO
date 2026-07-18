import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { setStockTo } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";
import type { DB } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Recalculate On-Hand — rebuild each product's stock from movement history.
//
// A migration/recovery tool for the case where a store has no real opening
// stock yet, only sales reports: the sales were recorded (for revenue) but
// never took anything off the shelf, because there was no starting number to
// subtract from, or because a blank stock count sat in the way. This walks the
// history and sets on-hand to what it should be:
//
//   on-hand = opening balances + receiving − sales − write-offs
//
// Deliberately NOT included: prior stock counts and manual STOCK_ADJUSTMENTs.
// This is a clean rebuild from primary movements, so a bogus count (e.g. one
// posted with everything counted as 0) and stale master-import quantities are
// discarded rather than re-applied. With no opening and no receiving, the
// result is simply −(units sold) — negative, which is the honest picture of a
// shop that has sold goods it never formally took into stock.
//
// Reliable movements (opening, receiving, write-off) are summed from the
// ledger, which current code always writes. Sales are summed from db.sales (the
// authoritative record) rather than the ledger, because older imports recorded
// the sale without ever writing a ledger line — that gap is exactly what this
// tool repairs. Ledger SALE / SALES_IMPORT / STOCK_ADJUSTMENT lines are ignored
// so nothing is double-counted, which also makes the recalculation idempotent:
// run it twice and the second run finds every product already on its target.
//
// Owner-only. Two-phase: POST ?mode=preview computes without writing; ?mode=
// commit applies the delta as a STOCK_ADJUSTMENT so the ledger keeps the trail.
// ---------------------------------------------------------------------------

type Row = {
  productId: string;
  sku: string;
  name: string;
  current: number;
  stockIn: number; // opening + receiving − write-offs (from the ledger)
  sold: number; // units sold across all sales on record
  target: number; // stockIn − sold
  delta: number; // target − current
};

// The stock-in side, straight from the reliable ledger entries. Write-offs are
// stored as negative deltas, so summing them here subtracts naturally.
const STOCK_IN_TYPES = new Set(["OPENING_BALANCE", "RECEIVING", "WRITE_OFF"]);

function compute(db: DB): Row[] {
  const stockIn = new Map<string, number>();
  for (const l of db.ledger) {
    if (!STOCK_IN_TYPES.has(l.type)) continue;
    stockIn.set(l.productId, (stockIn.get(l.productId) || 0) + l.qty);
  }
  const sold = new Map<string, number>();
  for (const s of db.sales) {
    if (s.cancelled) continue; // a voided sale's stock was already put back
    for (const it of s.items) {
      sold.set(it.productId, (sold.get(it.productId) || 0) + it.qty);
    }
  }

  const rows: Row[] = [];
  for (const p of db.products) {
    const si = Math.round((stockIn.get(p.id) || 0) * 1e6) / 1e6;
    const sd = Math.round((sold.get(p.id) || 0) * 1e6) / 1e6;
    const target = Math.round((si - sd) * 1e6) / 1e6;
    const delta = Math.round((target - p.stock) * 1e6) / 1e6;
    if (delta === 0) continue; // nothing to change for this product
    rows.push({ productId: p.id, sku: p.sku, name: p.name, current: p.stock, stockIn: si, sold: sd, target, delta });
  }
  // Biggest movers first so the preview leads with what matters.
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return rows;
}

function summarize(rows: Row[], totalProducts: number) {
  return {
    totalProducts,
    changed: rows.length,
    netUnits: Math.round(rows.reduce((s, r) => s + r.delta, 0) * 1e6) / 1e6,
    willBeNegative: rows.filter((r) => r.target < 0).length,
    soldUnits: Math.round(rows.reduce((s, r) => s + r.sold, 0) * 1e6) / 1e6,
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can recalculate on-hand" }, { status: 403 });
  }

  const mode = new URL(req.url).searchParams.get("mode") === "commit" ? "commit" : "preview";

  if (mode === "preview") {
    const db = await readDB();
    const rows = compute(db);
    return NextResponse.json({ mode, ...summarize(rows, db.products.length), rows: rows.slice(0, 500) });
  }

  const result = await mutateDB((db) => {
    // Recompute inside the write lock — a preview can go stale.
    const rows = compute(db);
    let applied = 0;
    for (const r of rows) {
      const product = db.products.find((p) => p.id === r.productId);
      if (!product) continue;
      setStockTo(db, product, r.target, {
        type: "STOCK_ADJUSTMENT",
        by: session.name,
        ref: "Recalculate on-hand",
        note: `rebuilt from history — in ${r.stockIn}, sold ${r.sold}`,
      });
      applied++;
    }
    const summary = summarize(rows, db.products.length);
    logAudit(db, {
      actor: session.name,
      action: "Adjusted",
      entityType: "Stock",
      entity: "Recalculate on-hand",
      detail: `${applied} product(s) rebuilt from history · net ${summary.netUnits >= 0 ? "+" : ""}${summary.netUnits} units · ${summary.willBeNegative} now negative`,
    });
    return { applied, summary };
  });

  return NextResponse.json({ mode, ...result.summary, applied: result.applied });
}
