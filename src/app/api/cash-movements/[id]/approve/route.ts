import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { canApproveCash } from "@/lib/access";

export const dynamic = "force-dynamic";

// Supervisor approves a pending cash movement (a cashier's cash-out, drop, …).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canApproveCash(session.role)) {
    return NextResponse.json({ error: "Only a supervisor can approve cash movements" }, { status: 403 });
  }
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const m = db.cashMovements.find((x) => x.id === params.id);
    if (!m) return { error: "not_found" as const };
    if (m.status === "approved") return { error: "already" as const };
    m.status = "approved";
    m.approvedBy = session.name;
    m.approvedAt = new Date().toISOString();
    logAudit(db, {
      actor,
      action: "Approved",
      entityType: "Sale",
      entity: m.id,
      detail: `${m.type} ${m.amount.toFixed(2)} approved`,
    });
    return { movement: m };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Movement not found" }, { status: 404 });
    return NextResponse.json({ error: "Already approved" }, { status: 400 });
  }
  return NextResponse.json(result.movement);
}
