import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { PRStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: PRStatus[] = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled", "Converted"];

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const pr = db.purchaseRequests.find((r) => r.id === params.id);
  if (!pr) return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  return NextResponse.json({ pr, business: db.meta.business });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const body = await req.json();
  const result = await mutateDB((db) => {
    const pr = db.purchaseRequests.find((r) => r.id === params.id);
    if (!pr) return null;

    if (body.status && STATUSES.includes(body.status) && body.status !== pr.status) {
      pr.status = body.status;
      if (body.status === "Approved" || body.status === "Rejected" || body.status === "Cancelled") {
        pr.decidedAt = new Date().toISOString();
      }
      // Every decision is stamped with the signed-in user.
      logAudit(db, { actor, action: body.status, entityType: "PR", entity: pr.prNo });
    }
    if (Array.isArray(body.items)) {
      pr.items = body.items.map((it: any) => ({
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        supplier: it.supplier || "—",
        unit: it.unit || "pcs",
        qty: Math.max(0, Number(it.qty) || 0),
        cost: Math.max(0, Number(it.cost) || 0),
        barcode: it.barcode || undefined,
      }));
    }
    if (typeof body.note === "string") pr.note = body.note.trim() || undefined;
    return pr;
  });

  if (!result) return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const ok = await mutateDB((db) => {
    const idx = db.purchaseRequests.findIndex((r) => r.id === params.id);
    if (idx === -1) return false;
    const [removed] = db.purchaseRequests.splice(idx, 1);
    logAudit(db, { actor, action: "Deleted", entityType: "PR", entity: removed.prNo });
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
