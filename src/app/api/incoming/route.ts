import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// What's already in the pipeline for each product, so a store building a new
// Purchase Request can see it's coming and not re-order a duplicate.
//
//  • onOrder   — units on OPEN purchase orders that haven't arrived yet
//                (qtyOrdered − qtyReceived, across POs not cancelled/closed).
//  • requested — units on PRs that are Submitted/Approved but not yet turned
//                into a PO. (A Converted PR already has its PO, counted above.)
//
// Both are in BASE units, the same as everything else in stock.
export async function GET() {
  const db = await readDB();
  const map: Record<string, { onOrder: number; requested: number }> = {};
  const bump = (id: string, key: "onOrder" | "requested", qty: number) => {
    if (!id || !(qty > 0)) return;
    (map[id] ||= { onOrder: 0, requested: 0 })[key] += qty;
  };

  // On the way: open POs, the part of each line still to be delivered.
  for (const po of db.purchaseOrders || []) {
    if (po.status === "Cancelled" || po.receivingClosed) continue;
    for (const it of po.items) {
      bump(it.productId, "onOrder", Math.max(0, (it.qtyOrdered || 0) - (it.qtyReceived || 0)));
    }
  }

  // Requested but not yet ordered: PRs still in approval, no PO cut yet.
  for (const pr of db.purchaseRequests || []) {
    if (pr.status !== "Submitted" && pr.status !== "Approved") continue;
    for (const it of pr.items) bump(it.productId, "requested", it.qty || 0);
  }

  return NextResponse.json(map);
}
