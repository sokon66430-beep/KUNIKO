import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Edit a write-off (quantity / reason / notes). Adjusts stock by the change and
// records who last edited it (audit trail).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const session = await getSession();
  const who = session?.name || "Staff";

  const result = await mutateDB((db) => {
    const wo = db.writeOffs.find((w) => w.id === params.id);
    if (!wo) return { error: "not_found" as const };
    const product = db.products.find((p) => p.id === wo.productId);

    if (body.quantity != null) {
      const newQty = Number(body.quantity);
      if (!Number.isFinite(newQty) || newQty <= 0) return { error: "Quantity must be greater than 0" as const };
      const delta = newQty - wo.quantity; // extra units to remove from stock
      if (product) {
        product.stock = Math.max(0, product.stock - delta); // never blocked by stock
      }
      wo.quantity = newQty;
    }
    if (typeof body.reason === "string" && body.reason.trim()) wo.reason = body.reason.trim();
    if (typeof body.notes === "string") wo.notes = body.notes.trim() || undefined;

    wo.updatedBy = who;
    wo.updatedAt = new Date().toISOString();
    logAudit(db, { actor: who, action: "Edited", entityType: "WriteOff", entity: wo.woNo });
    return { wo };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json({ error: notFound ? "Write-off not found" : result.error }, { status: notFound ? 404 : 400 });
  }
  return NextResponse.json(result.wo);
}

// Delete a write-off and give the stock back.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const who = session?.name || "Staff";
  const ok = await mutateDB((db) => {
    const idx = db.writeOffs.findIndex((w) => w.id === params.id);
    if (idx === -1) return false;
    const [removed] = db.writeOffs.splice(idx, 1);
    const product = db.products.find((p) => p.id === removed.productId);
    // A cancelled write-off already gave its stock back — don't restore twice.
    if (product && (removed.status || "Active") !== "Cancelled") product.stock += removed.quantity;
    logAudit(db, { actor: who, action: "Deleted", entityType: "WriteOff", entity: removed.woNo, detail: "stock restored" });
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Write-off not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
