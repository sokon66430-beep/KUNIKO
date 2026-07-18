import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { countTotal, drawerFor, openShiftForTerminal } from "@/lib/money";
import type { CashCount, Shift, ShiftName } from "@/lib/types";

export const dynamic = "force-dynamic";

const SHIFTS: ShiftName[] = ["A", "B", "C"];

// Each money record is linked Store (this file) · POS · Shift · Cashier · Time.
// GET returns recent shifts with their live drawer; POST opens a new shift after
// the cashier counts the opening float.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  const shifts = [...db.shifts]
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, 100)
    .map((s) => ({ ...s, drawer: drawerFor(db, s) }));
  return NextResponse.json({ drawerLimit: db.meta.business.cashDrawerLimit ?? 0, shifts });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const posTerminalId = String(body.posTerminalId || "").trim();
  const shift = body.shift as ShiftName;
  const openingCount: CashCount | undefined = body.openingCount;
  if (!posTerminalId) return NextResponse.json({ error: "Choose a POS terminal" }, { status: 400 });
  if (!SHIFTS.includes(shift)) return NextResponse.json({ error: "Choose a shift (A, B or C)" }, { status: 400 });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    // One open shift per till — the drawer can't belong to two people at once.
    const existing = openShiftForTerminal(db, posTerminalId);
    if (existing) {
      return { error: `${posTerminalId} already has an open shift (${existing.shift}, ${existing.cashier}). Close it first.` };
    }
    const openingFloat = countTotal(openingCount);
    const s: Shift = {
      id: `SH-${String(db.meta.nextShift++).padStart(6, "0")}`,
      posTerminalId,
      shift,
      cashier: session.name,
      cashierId: session.uid,
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: session.name,
      openingFloat,
      openingCount: openingCount || undefined,
      openingNote: body.note ? String(body.note) : undefined,
    };
    db.shifts.push(s);
    logAudit(db, {
      actor,
      action: "Opened",
      entityType: "Sale",
      entity: `Shift ${s.id}`,
      detail: `${posTerminalId} · Shift ${shift} · opening float ${openingFloat.toFixed(2)}`,
    });
    return { shift: s };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.shift, { status: 201 });
}
