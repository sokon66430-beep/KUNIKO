import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { drawerFor, countTotal } from "@/lib/money";
import { findManagerByCode } from "@/lib/managerAuth";
import type { CashCount, ShiftSurvey } from "@/lib/types";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  const shiftId = new URL(req.url).searchParams.get("shiftId");
  let list = [...(db.surveys || [])];
  if (shiftId) list = list.filter((s) => s.shiftId === shiftId);
  list.sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json(list.slice(0, 200));
}

// Record a shift survey — a mid-shift money check on an OPEN shift. Everything
// (expected, sold mix, variance) is computed server-side from the drawer engine
// so the record can't be fudged from the client; only the physical count comes
// from the till. Returns the saved survey, which the till prints as a slip.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const count = body.count as CashCount | undefined;
  if (!count) return NextResponse.json({ error: "A counted drawer is required" }, { status: 400 });

  // Manager-only function: a store manager / assistant store manager (or owner)
  // must approve. Verify the code before recording anything.
  const mgr = await findManagerByCode(String(body.managerCode || ""), { storeId: session.storeId });
  if (!mgr) {
    return NextResponse.json(
      { error: "Manager code not recognised — only a store manager or assistant store manager can run a shift survey." },
      { status: 403 },
    );
  }

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === body.shiftId);
    if (!shift) return { error: "no_shift" as const };
    if (shift.status !== "open") return { error: "locked" as const };

    const rate = db.meta.business?.exchangeRate || 4100;
    const d = drawerFor(db, shift);
    const expected = round2(d.expected);
    const counted = countTotal(count, rate);
    const variance = round2(counted - expected);
    const countedUsd = round2((count.denoms || []).reduce((s, x) => s + (Number(x.denom) || 0) * (Number(x.count) || 0), 0) + (Number(count.coins) || 0));
    const countedRiel = (count.riel || []).reduce((s, x) => s + (Number(x.denom) || 0) * (Number(x.count) || 0), 0);

    const survey: ShiftSurvey = {
      id: `SV-${String(db.meta.nextSurvey++).padStart(6, "0")}`,
      shiftId: shift.id,
      posTerminalId: shift.posTerminalId,
      shift: shift.shift,
      at: new Date().toISOString(),
      by: mgr.name,
      byId: session.uid,
      expected,
      counted,
      variance,
      matched: variance === 0,
      countedUsd,
      countedRiel,
      count,
      sales: { total: d.sales.total, cash: d.sales.cash, card: d.sales.card, ewallet: d.sales.ewallet },
      note: body.note ? String(body.note) : undefined,
    };
    db.surveys.push(survey);
    logAudit(db, {
      actor,
      action: "Recorded",
      entityType: "Sale",
      entity: `Shift Survey ${survey.id}`,
      detail: `${shift.posTerminalId} · Shift ${shift.shift} · expected $${expected.toFixed(2)} · counted $${counted.toFixed(2)} · ${
        variance === 0 ? "matched" : variance < 0 ? `short $${Math.abs(variance).toFixed(2)}` : `over $${variance.toFixed(2)}`
      }`,
    });
    return { survey };
  });

  if ("error" in result) {
    if (result.error === "no_shift") return NextResponse.json({ error: "Open a shift first" }, { status: 400 });
    return NextResponse.json({ error: "This shift is closed" }, { status: 400 });
  }
  return NextResponse.json(result.survey, { status: 201 });
}
