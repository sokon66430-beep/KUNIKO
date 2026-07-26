import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { publish } from "@/lib/realtime";
import { advanceTicket } from "@/lib/queue";
import type { QueueStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: QueueStatus[] = ["preparing", "ready", "completed"];

/**
 * Kitchen Display actions: START → READY → COMPLETED.
 *
 * POST /api/queue/Q-000012/status  { status, stationId?, device? }
 *
 * Any signed-in till/kitchen user may drive this — the people on the line are
 * crew, and making them fetch a supervisor to press READY would simply mean
 * nobody presses it. Cancelling is NOT here: it voids a customer's order and
 * keeps its own supervisor-gated route.
 *
 * `stationId` moves just that station's lane (the Grill finishing before the
 * Fry); omitting it drives the whole ticket. The roll-up from lanes to ticket
 * lives in lib/queue so the KDS and any future caller can't disagree about it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const actor = await currentActor();

  const body = await req.json().catch(() => ({}));
  const status = String(body?.status || "") as QueueStatus;
  if (!ALLOWED.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${ALLOWED.join(", ")}` }, { status: 400 });
  }
  const stationId = typeof body?.stationId === "string" && body.stationId ? body.stationId : undefined;
  const device = typeof body?.device === "string" && body.device ? body.device : undefined;

  const result = await mutateDB((db) => {
    const ticket = db.queue.find((t) => t.id === params.id);
    if (!ticket) return { error: "Ticket not found", status: 404 as const };
    if (ticket.status === "cancelled") return { error: "That order was cancelled", status: 400 as const };

    const moved = advanceTicket(ticket, status, { by: actor, device, stationId }, new Date().toISOString());
    if (!moved.ok) return { error: moved.error, status: 409 as const };
    return { ticket };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Tell every kitchen screen and customer TV in this store, so a READY press
  // lands on the TV without anyone refreshing anything.
  publish(session.storeId, "queue:changed", { ticketId: params.id, status });
  return NextResponse.json(result.ticket);
}
