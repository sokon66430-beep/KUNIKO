import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { canApproveCash } from "@/lib/access";
import { drawerFor } from "@/lib/money";
import type { CashMovement, CashMovementType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES: CashMovementType[] = ["CASH_IN", "CASH_OUT", "DROP", "REFUND", "BANK_DEPOSIT"];
// Movements that take cash OUT of the drawer. You can never remove more than is
// physically there, so these are capped at the drawer's available cash — the
// guard that stops an impossible entry (a fat-fingered $2,332,436 safe drop).
const OUTFLOWS: CashMovementType[] = ["CASH_OUT", "DROP", "REFUND", "BANK_DEPOSIT"];
const LABEL: Record<CashMovementType, string> = {
  CASH_IN: "Cash In",
  CASH_OUT: "Cash Out",
  DROP: "Safe Drop",
  REFUND: "Cash Refund",
  BANK_DEPOSIT: "Bank Deposit",
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
  // The amount is entered as two currencies: dollars and riel notes, kept
  // separate. Legacy callers send a single `amount` (dollars) — treat as USD.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const hasSplit = body.amountUsd != null || body.amountRiel != null;
  const amountUsd = round2(Math.max(0, hasSplit ? Number(body.amountUsd) || 0 : Number(body.amount) || 0));
  const amountRiel = hasSplit ? Math.max(0, Math.floor(Number(body.amountRiel) || 0)) : 0;
  const reason = String(body.reason || "").trim();
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Unknown movement type" }, { status: 400 });
  if (!(amountUsd > 0 || amountRiel > 0)) return NextResponse.json({ error: "Enter an amount greater than zero" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === body.shiftId);
    if (!shift) return { error: "no_shift" as const };
    if (shift.status !== "open") return { error: "locked" as const };

    // USD-equivalent total the drawer runs on = dollars + riel at the store rate.
    const rate = db.meta.business?.exchangeRate || 4100;
    const amount = round2(amountUsd + amountRiel / rate);

    // Guard: you can't take out more cash than the drawer holds. Reject any
    // outflow bigger than the available cash (a small epsilon covers rounding).
    // This is what makes an impossible entry impossible, not just discouraged.
    if (OUTFLOWS.includes(type)) {
      const available = round2(drawerFor(db, shift).expected);
      if (amount > available + 0.005) {
        return { error: "insufficient" as const, available: Math.max(0, available), tried: amount };
      }
    }

    // A bank deposit snapshots the store's one fixed bank (set in Settings) and
    // keeps the deposit slip / transaction reference for matching the statement.
    const isDeposit = type === "BANK_DEPOSIT";
    const bank = isDeposit ? (db.meta.business?.bankAccount?.name || "").trim() || undefined : undefined;
    const reference = isDeposit ? String(body.reference || "").trim() || undefined : undefined;

    const isSupervisor = canApproveCash(session.role);
    const now = new Date().toISOString();
    const m: CashMovement = {
      id: `CM-${String(db.meta.nextCashMovement++).padStart(6, "0")}`,
      shiftId: shift.id,
      posTerminalId: shift.posTerminalId,
      type,
      amount,
      amountUsd,
      amountRiel,
      reason,
      notes: body.notes ? String(body.notes) : undefined,
      attachment: typeof body.attachment === "string" && body.attachment ? body.attachment : undefined,
      bank,
      reference,
      at: now,
      createdBy: session.name,
      cashierId: session.uid,
      status: isSupervisor ? "approved" : "pending",
      approvedBy: isSupervisor ? session.name : undefined,
      approvedAt: isSupervisor ? now : undefined,
    };
    db.cashMovements.push(m);
    const money = `$${amountUsd.toFixed(2)}${amountRiel ? ` + ${amountRiel.toLocaleString()}៛` : ""} (= $${amount.toFixed(2)})`;
    const bankNote = isDeposit ? ` · ${bank || "bank"}${reference ? ` · ref ${reference}` : ""}` : "";
    logAudit(db, {
      actor,
      action: "Recorded",
      entityType: "Sale",
      entity: `${LABEL[type]} ${m.id}`,
      detail: `${shift.posTerminalId} · Shift ${shift.shift} · ${LABEL[type]} ${money}${bankNote} · ${reason}${
        isSupervisor ? " · auto-approved" : " · pending approval"
      }`,
    });
    return { movement: m };
  });

  if ("error" in result) {
    if (result.error === "no_shift") return NextResponse.json({ error: "Open a shift first" }, { status: 400 });
    if (result.error === "insufficient") {
      const verb = type === "BANK_DEPOSIT" ? "deposit" : type === "DROP" ? "drop" : type === "REFUND" ? "refund" : "take out";
      return NextResponse.json(
        { error: `Can't ${verb} $${result.tried.toFixed(2)} — only $${result.available.toFixed(2)} is in the drawer.` },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "This shift is closed — reopen it to record cash movements" }, { status: 400 });
  }
  return NextResponse.json(result.movement, { status: 201 });
}
