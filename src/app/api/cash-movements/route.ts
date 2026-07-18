import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { canApproveCash } from "@/lib/access";
import type { CashMovement, CashMovementType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES: CashMovementType[] = ["CASH_IN", "CASH_OUT", "DROP", "REFUND"];
const LABEL: Record<CashMovementType, string> = {
  CASH_IN: "Cash In",
  CASH_OUT: "Cash Out",
  DROP: "Safe Drop",
  REFUND: "Cash Refund",
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  const shiftId = new URL(req.url).searchParams.get("shiftId");
  let list = [...db.cashMovements];
  if (shiftId) list = list.filter((m) => m.shiftId === shiftId);
  list.sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json(list.slice(0, 200));
}

// Record a cash movement (in / out / drop / refund). It hits the drawer at once
// because the money has physically moved; approval is the oversight trail on
// top. A supervisor's own movement is auto-approved; a cashier's starts pending.
// Movements can only be added to an OPEN shift — a closed shift is locked.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const type = body.type as CashMovementType;
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  const reason = String(body.reason || "").trim();
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Unknown movement type" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "Enter an amount greater than zero" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === body.shiftId);
    if (!shift) return { error: "no_shift" as const };
    if (shift.status !== "open") return { error: "locked" as const };

    const isSupervisor = canApproveCash(session.role);
    const now = new Date().toISOString();
    const m: CashMovement = {
      id: `CM-${String(db.meta.nextCashMovement++).padStart(6, "0")}`,
      shiftId: shift.id,
      posTerminalId: shift.posTerminalId,
      type,
      amount,
      reason,
      notes: body.notes ? String(body.notes) : undefined,
      attachment: typeof body.attachment === "string" && body.attachment ? body.attachment : undefined,
      at: now,
      createdBy: session.name,
      cashierId: session.uid,
      status: isSupervisor ? "approved" : "pending",
      approvedBy: isSupervisor ? session.name : undefined,
      approvedAt: isSupervisor ? now : undefined,
    };
    db.cashMovements.push(m);
    logAudit(db, {
      actor,
      action: "Recorded",
      entityType: "Sale",
      entity: `${LABEL[type]} ${m.id}`,
      detail: `${shift.posTerminalId} · Shift ${shift.shift} · ${LABEL[type]} ${amount.toFixed(2)} · ${reason}${
        isSupervisor ? " · auto-approved" : " · pending approval"
      }`,
    });
    return { movement: m };
  });

  if ("error" in result) {
    if (result.error === "no_shift") return NextResponse.json({ error: "Open a shift first" }, { status: 400 });
    return NextResponse.json({ error: "This shift is closed — reopen it to record cash movements" }, { status: 400 });
  }
  return NextResponse.json(result.movement, { status: 201 });
}
