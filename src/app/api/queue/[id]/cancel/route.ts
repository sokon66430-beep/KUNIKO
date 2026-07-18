import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { canManageQueue } from "@/lib/access";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Cancel a wrong pickup number. Supervisor-only. The ticket is voided (marked
// cancelled) rather than deleted, so the record of what happened survives. The
// counter is untouched — numbers cycle anyway, and rewinding it could collide
// with a number already handed to another customer.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageQueue(session.role)) {
    return NextResponse.json({ error: "Only a supervisor can cancel a queue number" }, { status: 403 });
  }
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const ticket = db.queue.find((t) => t.id === params.id);
    if (!ticket) return { error: "not_found" as const };
    if (ticket.status === "cancelled") return { error: "already" as const };
    ticket.status = "cancelled";
    ticket.cancelledAt = new Date().toISOString();
    ticket.cancelledBy = actor;
    logAudit(db, {
      actor,
      action: "Cancelled",
      entityType: "Sale",
      entity: `Queue ${String(ticket.number).padStart(3, "0")}`,
      detail: `Pickup number ${String(ticket.number).padStart(3, "0")} voided (receipt ${ticket.receiptNo})`,
    });
    return { ticket };
  });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Queue ticket not found" }, { status: 404 });
    return NextResponse.json({ error: "That number is already cancelled" }, { status: 400 });
  }
  return NextResponse.json(result.ticket);
}
