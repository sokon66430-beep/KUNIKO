import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { canManageQueue } from "@/lib/access";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Reset the store's pickup-number counter to 0 — the next number issued will be
// 001. Supervisor-only (store leadership and above). Existing tickets are left
// on record; this only rewinds the counter, e.g. at the start of a shift.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageQueue(session.role)) {
    return NextResponse.json({ error: "Only a supervisor can reset the queue" }, { status: 403 });
  }
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const from = db.meta.queue?.current ?? 0;
    db.meta.queue = { current: 0, updatedAt: new Date().toISOString() };
    logAudit(db, {
      actor,
      action: "Reset",
      entityType: "Sale",
      entity: "Queue counter",
      detail: `Pickup-number counter reset (was ${String(from).padStart(3, "0")}) — next number will be 001`,
    });
    return { current: 0 };
  });
  return NextResponse.json(result);
}
