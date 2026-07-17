import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";
import { poStatus, reflectProductChanges } from "@/lib/procurement";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const stored = db.purchaseOrders.find((p) => p.id === params.id);
  if (!stored) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  // Open / Partial POs reflect current product data (name, barcode, unit, cost).
  const po = reflectProductChanges(stored, db.products);
  // The PO's tax follows its supplier: each supplier carries its own tax % (10 by
  // default, 0 for a tax-free supplier). Fall back to the business VAT only when
  // the PO's supplier isn't in the list.
  const supplier = db.suppliers.find((s) => s.name === po.supplier);
  const vatRate = supplier ? (supplier.taxPct ?? 10) / 100 : db.meta.business.vatRate ?? 0.1;
  return NextResponse.json({ po, business: db.meta.business, vatRate });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const body = await req.json();
  // Editing the PO's line items is a procurement action — resolve the role in
  // the request scope, before the write-lock.
  const session = await getSession();
  // Any signed-in user may adjust the ORDERED QTY (and remove a not-yet-received
  // line). Unit cost is NEVER editable on a PO — for anyone, owner included:
  // product prices are managed in Master Data only. Deleting a whole PO stays
  // restricted to owner / procurement in the DELETE handler below.
  const canEditItems = !!session;
  const result = await mutateDB((db) => {
    const po = db.purchaseOrders.find((p) => p.id === params.id);
    if (!po) return null;
    if (body.action === "cancel" && po.status !== "Cancelled") {
      po.status = "Cancelled";
      logAudit(db, { actor, action: "Cancelled", entityType: "PO", entity: po.poNo });
    }
    // A PO that's been sent is locked: the supplier is holding that document, so
    // changing what it says here would put the two out of step with nothing to
    // show for it. Untick "sent" first if it really needs changing (and send the
    // corrected order again).
    if (Array.isArray(body.items) && po.sentToSupplier) {
      return { error: `${po.poNo} has already been sent to ${po.supplier}. Untick "Sent" to change it.` };
    }

    // Adjust the PO's lines: change ordered qty or remove a line. Never below
    // what's already received. Cancelled POs are locked.
    if (Array.isArray(body.items) && po.status !== "Cancelled" && canEditItems) {
      let changed = false;
      for (const edit of body.items as { productId: string; qtyOrdered?: number; cost?: number; remove?: boolean }[]) {
        const line = po.items.find((i) => i.productId === edit.productId);
        if (!line) continue;
        if (edit.remove) {
          if (line.qtyReceived === 0) {
            po.items = po.items.filter((i) => i.productId !== edit.productId);
            changed = true;
          }
          continue;
        }
        if (edit.qtyOrdered != null) {
          const q = Math.max(line.qtyReceived, Math.floor(Number(edit.qtyOrdered) || 0));
          if (q !== line.qtyOrdered) {
            line.qtyOrdered = q;
            changed = true;
          }
        }
        // Cost edits are ignored outright — unit cost only changes via Master Data.
      }
      if (po.items.length) po.status = poStatus(po); // keep status in sync with new totals
      if (changed) logAudit(db, { actor, action: "Edited", entityType: "PO", entity: po.poNo });
    }

    if (typeof body.note === "string") po.note = body.note.trim() || undefined;
    if (typeof body.expectedDate === "string") po.expectedDate = body.expectedDate || undefined;
    // Tick/untick "sent to supplier" — a workflow marker so the team can see
    // at a glance which POs have already gone out.
    if (typeof body.sentToSupplier === "boolean") {
      // Ticking "sent" FREEZES the lines — so first write down what's actually
      // going out. Until this moment an Open PO only *displays* live product
      // data (see reflectProductChanges); the stored lines can be older. Locking
      // without persisting what was on screen would make the PO snap back to a
      // stale cost the supplier never saw.
      if (body.sentToSupplier) {
        po.items = reflectProductChanges(po, db.products).items.map((i) => ({ ...i }));
      }
      po.sentToSupplier = body.sentToSupplier || undefined;
      logAudit(db, {
        actor,
        action: body.sentToSupplier ? "Marked sent" : "Unmarked sent",
        entityType: "PO",
        entity: po.poNo,
        detail: body.sentToSupplier ? "lines frozen as sent" : "reopened for editing",
      });
    }
    return po;
  });
  if (!result) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const session = await getSession();
  if (!session || (session.role !== "owner" && session.role !== "procurement")) {
    return NextResponse.json({ error: "Only the owner or procurement can delete a PO" }, { status: 403 });
  }
  const result = await mutateDB((db) => {
    const idx = db.purchaseOrders.findIndex((p) => p.id === params.id);
    if (idx === -1) return { error: "not_found" as const };
    const po = db.purchaseOrders[idx];
    // A PO whose goods were (even partly) received can't be deleted — that stock
    // is already on hand and would be orphaned. Cancel it instead.
    if (po.items.some((i) => i.qtyReceived > 0)) return { error: "received" as const };
    db.purchaseOrders.splice(idx, 1);
    logAudit(db, { actor, action: "Deleted", entityType: "PO", entity: po.poNo });
    return { ok: true as const };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    return NextResponse.json(
      { error: "This PO already has received goods — cancel it instead of deleting." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
