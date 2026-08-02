import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { countTotal, drawerFor } from "@/lib/money";
import { findManagerByCode } from "@/lib/managerAuth";
import type { CashCount } from "@/lib/types";

export const dynamic = "force-dynamic";

// Submit a shift for close: the cashier counts the drawer, the system works out
// the expected figure and the variance, and the shift moves to pending_close for
// a supervisor to approve. A non-zero variance MUST carry a reason. This does
// not lock the shift — approval does.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const closingCount: CashCount | undefined = body.closingCount;
  const varianceReason = String(body.varianceReason || "").trim();

  // Closing a shift is a manager-only function: a store manager / assistant store
  // manager (or owner) must approve. Verify the code before touching the shift.
  const mgr = await findManagerByCode(String(body.managerCode || ""), { storeId: session.storeId, purpose: "approveCash" });
  if (!mgr) {
    return NextResponse.json(
      { error: "Manager code not recognised — only a supervisor or manager can close a shift." },
      { status: 403 },
    );
  }
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const shift = db.shifts.find((s) => s.id === params.id);
    if (!shift) return { error: "not_found" as const };
    if (shift.status !== "open") return { error: "not_open" as const };

    const drawer = drawerFor(db, shift);
    const actualCash = countTotal(closingCount, db.meta.business.exchangeRate);
    const variance = Math.round((actualCash - drawer.expected) * 100) / 100;
    if (variance !== 0 && !varianceReason) return { error: "reason_required" as const, variance };

    shift.status = "pending_close";
    shift.submittedAt = new Date().toISOString();
    shift.expectedCash = drawer.expected;
    shift.actualCash = actualCash;
    shift.closingCount = closingCount || undefined;
    shift.variance = variance;
    shift.varianceReason = variance !== 0 ? varianceReason : undefined;

    logAudit(db, {
      actor,
      action: "Submitted",
      entityType: "Sale",
      entity: `Shift ${shift.id}`,
      detail: `Close submitted · expected ${drawer.expected.toFixed(2)} · counted ${actualCash.toFixed(2)} · variance ${
        variance >= 0 ? "+" : ""
      }${variance.toFixed(2)}${variance !== 0 ? ` · ${varianceReason}` : ""} · approved by ${mgr.name}`,
    });
    return { shift, variance };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    if (result.error === "not_open") return NextResponse.json({ error: "This shift isn't open" }, { status: 400 });
    return NextResponse.json({ error: `A reason is required for a variance of ${result.variance}`, variance: result.variance }, { status: 400 });
  }
  return NextResponse.json(result);
}
