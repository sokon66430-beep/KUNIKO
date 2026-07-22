import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { nextPoNumber, findMergeablePO, appendItemsToPO, reflectProductChanges } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { PurchaseOrder, POItem } from "@/lib/types";
import { purchaseUnitCost } from "@/lib/sellingUnits";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  // ONE RECEIPT PER PO: any PO that already has a goods receipt is done and must
  // leave Receiving. New receipts set `receivingClosed` when they're created, but
  // POs received before that rule existed (or whose invoice was scanned in later)
  // don't carry the flag — so derive it here from the receipts on file. This is
  // read-only: no PO is mutated, the list just reports the true closed state.
  const receivedPoIds = new Set(db.goodsReceipts.map((g) => g.poId));
  // Open / Partial POs reflect the current product master (name, barcode, unit,
  // cost); received/cancelled keep their snapshot.
  const list = [...db.purchaseOrders]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .map((po) => {
      const reflected = reflectProductChanges(po, db.products);
      return receivedPoIds.has(po.id) ? { ...reflected, receivingClosed: true } : reflected;
    });
  return NextResponse.json(list);
}

// Create a PO directly (without a PR). All items must share one supplier.
export async function POST(req: Request) {
  const actor = await currentActor();
  const body = await req.json();
  const items: POItem[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
  }

  const created = await mutateDB((db) => {
    const now = new Date();
    const supplier = body.supplier?.trim() || "—";
    const lines: POItem[] = items.map((it) => {
      // Case pricing: when the product has a case price set, the PO books at that
      // case rate per unit — not the single-unit cost — so the order value, the
      // receipt and the stock value all agree. Falls back to the product's own
      // cost (then whatever the client sent) when no case price is set.
      const product = db.products.find((p) => p.id === it.productId);
      const cost = product ? purchaseUnitCost(product) : Math.max(0, Number(it.cost) || 0);
      return {
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        unit: it.unit || "pcs",
        qtyOrdered: Math.max(0, Number(it.qtyOrdered) || 0),
        qtyReceived: 0,
        cost,
        barcode: it.barcode || undefined,
        uomSize: it.uomSize || undefined,
      };
    });

    // Same supplier, same day, still Open → add to that PO instead of a new one.
    const mergeInto = findMergeablePO(db, supplier, now);
    if (mergeInto) {
      const { added, merged } = appendItemsToPO(mergeInto, lines);
      logAudit(db, {
        actor,
        action: "Updated",
        entityType: "PO",
        entity: mergeInto.poNo,
        detail: `Added ${added} new line${added === 1 ? "" : "s"}${merged ? ` · topped up ${merged}` : ""} (same-day order)`,
      });
      return mergeInto;
    }

    const n = db.meta.nextPO++;
    const po: PurchaseOrder = {
      id: `po${n}`,
      poNo: nextPoNumber(db.purchaseOrders.map((p) => p.poNo), now),
      supplier,
      status: "Open",
      note: body.note?.trim() || undefined,
      expectedDate: body.expectedDate || undefined,
      items: lines,
      createdAt: now.toISOString(),
    };
    db.purchaseOrders.push(po);
    logAudit(db, {
      actor,
      action: "Created",
      entityType: "PO",
      entity: po.poNo,
      detail: `${po.supplier} · ${po.items.length} item${po.items.length === 1 ? "" : "s"}`,
    });
    return po;
  });

  return NextResponse.json(created, { status: 201 });
}
