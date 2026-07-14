import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";
import { poStatus } from "@/lib/procurement";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const po = db.purchaseOrders.find((p) => p.id === params.id);
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  return NextResponse.json({ po, business: db.meta.business });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const body = await req.json();
  // Editing the PO's line items is a procurement action — resolve the role in
  // the request scope, before the write-lock.
  const session = await getSession();
  const canEditItems = !!session && (session.role === "owner" || session.role === "procurement");
  const result = await mutateDB((db) => {
    const po = db.purchaseOrders.find((p) => p.id === params.id);
    if (!po) return null;
    if (body.action === "cancel" && po.status !== "Cancelled") {
      po.status = "Cancelled";
      logAudit(db, { actor, action: "Cancelled", entityType: "PO", entity: po.poNo });
    }
    // Procurement adjusts the PO's lines directly: change ordered qty / unit
    // cost, or remove a line. Never below what's already received. Cancelled
    // POs are locked.
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
        if (edit.cost != null) {
          const c = Math.max(0, Number(edit.cost) || 0);
          if (c !== line.cost) {
            line.cost = c;
            changed = true;
          }
        }
      }
      if (po.items.length) po.status = poStatus(po); // keep status in sync with new totals
      if (changed) logAudit(db, { actor, action: "Edited", entityType: "PO", entity: po.poNo });
    }

    if (typeof body.note === "string") po.note = body.note.trim() || undefined;
    if (typeof body.expectedDate === "string") po.expectedDate = body.expectedDate || undefined;
    // Tick/untick "sent to supplier" — a workflow marker so the team can see
    // at a glance which POs have already gone out.
    if (typeof body.sentToSupplier === "boolean") {
      po.sentToSupplier = body.sentToSupplier || undefined;
      logAudit(db, {
        actor,
        action: body.sentToSupplier ? "Marked sent" : "Unmarked sent",
        entityType: "PO",
        entity: po.poNo,
      });
    }
    return po;
  });
  if (!result) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const ok = await mutateDB((db) => {
    const idx = db.purchaseOrders.findIndex((p) => p.id === params.id);
    if (idx === -1) return false;
    db.purchaseOrders.splice(idx, 1);
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
