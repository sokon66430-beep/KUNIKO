import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

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
  const result = await mutateDB((db) => {
    const po = db.purchaseOrders.find((p) => p.id === params.id);
    if (!po) return null;
    if (body.action === "cancel" && po.status !== "Cancelled") {
      po.status = "Cancelled";
      logAudit(db, { actor, action: "Cancelled", entityType: "PO", entity: po.poNo });
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
