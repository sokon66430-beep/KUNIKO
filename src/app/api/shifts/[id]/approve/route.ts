import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { canApproveCash } from "@/lib/access";

export const dynamic = "force-dynamic";

// Supervisor approves a submitted close: the shift LOCKS. After this its cash
// movements and amounts can't be edited or deleted — only a manager can reopen
// it, and that leaves an audit line.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canApproveCash(session.role)) {
    return NextResponse.json({ error: "Only a supervisor can approve a shift close" }, { status: 403 });
  }
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === params.id);
    if (!shift) return { error: "not_found" as const };
    if (shift.status !== "pending_close") return { error: "not_pending" as const };
    shift.status = "closed";
    shift.closedAt = new Date().toISOString();
    shift.closedBy = session.name;
    logAudit(db, {
      actor,
      action: "Approved",
      entityType: "Sale",
      entity: `Shift ${shift.id}`,
      detail: `Close approved & locked · variance ${shift.variance != null && shift.variance >= 0 ? "+" : ""}${(shift.variance ?? 0).toFixed(2)}`,
    });
    return { shift };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    return NextResponse.json({ error: "This shift isn't awaiting approval" }, { status: 400 });
  }
  return NextResponse.json(result.shift);
}
