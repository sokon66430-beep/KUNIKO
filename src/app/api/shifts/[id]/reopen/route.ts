import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { canReopenShift } from "@/lib/access";

export const dynamic = "force-dynamic";

// Manager reopens a locked shift. The close figures are kept as history and the
// shift goes back to open so movements/sales attribute again; the reopen is
// recorded with who, when and why.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canReopenShift(session.role)) {
    return NextResponse.json({ error: "Only a manager can reopen a shift" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const note = String(body.note || "").trim();
  if (!note) return NextResponse.json({ error: "A reason is required to reopen a shift" }, { status: 400 });
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === params.id);
    if (!shift) return { error: "not_found" as const };
    if (shift.status !== "closed") return { error: "not_closed" as const };
    shift.status = "open";
    shift.reopenedAt = new Date().toISOString();
    shift.reopenedBy = session.name;
    shift.reopenNote = note;
    logAudit(db, {
      actor,
      action: "Reopened",
      entityType: "Sale",
      entity: `Shift ${shift.id}`,
      detail: `Reopened by manager — ${note}`,
    });
    return { shift };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    return NextResponse.json({ error: "Only a locked (closed) shift can be reopened" }, { status: 400 });
  }
  return NextResponse.json(result.shift);
}
