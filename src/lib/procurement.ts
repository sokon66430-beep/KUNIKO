import type { DB, Product, PurchaseOrder, POItem, POStatus } from "./types";

/** Suggested reorder quantity to bring a low item back to a healthy level. */
export function suggestedQty(p: Product): number {
  const target = Math.max(p.reorderLevel * 2, p.reorderLevel + 1);
  return Math.max(target - p.stock, 0);
}

/** Derive PO status from how much of each line has been received. */
export function poStatus(po: PurchaseOrder): POStatus {
  if (po.status === "Cancelled") return "Cancelled";
  const anyReceived = po.items.some((i) => i.qtyReceived > 0);
  const allReceived = po.items.every((i) => i.qtyReceived >= i.qtyOrdered);
  if (allReceived) return "Received";
  if (anyReceived) return "Partial";
  return "Open";
}

export const poTotal = (po: PurchaseOrder): number =>
  po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);

/**
 * Generate the next PO document number as `PO-YYYYMMDD-NN`, where NN is a
 * two-digit sequence that restarts at 01 each day. Derives the sequence from
 * the PO numbers already issued that day, so it works even when several POs
 * are created in one batch (call it again after pushing each new PO).
 */
/** True when two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Find a still-open PO for the same supplier created today, so a second order
 * to that supplier on the same day is added to it instead of opening a new PO.
 * Only merges into POs that are Open (nothing received yet) and not cancelled.
 */
export function findMergeablePO(
  db: DB,
  supplier: string,
  now: Date,
): PurchaseOrder | undefined {
  return db.purchaseOrders.find(
    (p) =>
      p.supplier === supplier &&
      p.status !== "Cancelled" &&
      poStatus(p) === "Open" &&
      isSameDay(new Date(p.createdAt), now),
  );
}

/**
 * Append order lines to an existing PO. A line for a product already on the PO
 * has its ordered quantity increased; anything new is added as a fresh line.
 * Returns the count of lines added vs. merged, for the audit trail.
 */
export function appendItemsToPO(po: PurchaseOrder, items: POItem[]): { added: number; merged: number } {
  let added = 0;
  let merged = 0;
  for (const it of items) {
    const existing = po.items.find(
      (l) =>
        (it.productId && l.productId === it.productId) ||
        (it.barcode && l.barcode === it.barcode),
    );
    if (existing) {
      existing.qtyOrdered += it.qtyOrdered;
      merged++;
    } else {
      po.items.push(it);
      added++;
    }
  }
  return { added, merged };
}

export function nextPoNumber(existingPoNos: string[], now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `PO-${y}${m}${d}-`;
  let max = 0;
  for (const no of existingPoNos) {
    if (no.startsWith(prefix)) {
      const seq = parseInt(no.slice(prefix.length), 10);
      if (Number.isFinite(seq)) max = Math.max(max, seq);
    }
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}
