import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

// Request a write-off cancellation. Stock does NOT change here — the record is
// marked "PendingCancel" until a Manager / Assistant Manager approves it.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const session = await getSession();
  const who = session?.name || "Staff";
  const decision = body?.decision as "approve" | "reject" | undefined;

  const result = await mutateDB((db) => {
    const wo = db.writeOffs.find((w) => w.id === params.id);
    if (!wo) return { error: "not_found" as const };
    const status = wo.status || "Active";

    // Step 1 — no decision: staff requests the cancel.
    if (!decision) {
      if (status !== "Active") return { error: "This write-off is already " + status.toLowerCase() };
      wo.status = "PendingCancel";
      wo.cancelRequestedBy = who;
      wo.cancelRequestedAt = new Date().toISOString();
      logAudit(db, {
        actor: who,
        action: "Cancel requested",
        entityType: "WriteOff",
        entity: wo.woNo,
        detail: "awaiting manager approval",
      });
      return { wo };
    }

    // Step 2 — manager decides, proving identity with their approval code.
    if (status !== "PendingCancel") return { error: "No cancel request is pending on this write-off" };
    const code = String(body?.code || "").trim();
    const approver = (db.meta.business.approvers || []).find((a) => a.code && a.code === code);
    if (!approver) return { error: "bad_code" as const };
    const approverName = `${approver.role}${approver.name ? ` (${approver.name})` : ""}`;

    if (decision === "reject") {
      wo.status = "Active";
      wo.cancelRequestedBy = undefined;
      wo.cancelRequestedAt = undefined;
      logAudit(db, { actor: approverName, action: "Cancel rejected", entityType: "WriteOff", entity: wo.woNo });
      return { wo };
    }

    // Approve: the write-off is cancelled and the stock goes back.
    const product = db.products.find((p) => p.id === wo.productId);
    if (product) {
      postLedger(db, product, { type: "WRITE_OFF", qty: wo.quantity, by: approverName, ref: wo.woNo, note: "write-off cancelled — stock returned" });
    }
    wo.status = "Cancelled";
    wo.cancelledBy = approverName;
    wo.cancelledAt = new Date().toISOString();
    logAudit(db, {
      actor: approverName,
      action: "Cancelled",
      entityType: "WriteOff",
      entity: wo.woNo,
      detail: `${wo.quantity} ${wo.unit} of ${wo.productName} returned to stock`,
    });
    return { wo };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Write-off not found" }, { status: 404 });
    if (result.error === "bad_code") return NextResponse.json({ error: "Invalid approval code" }, { status: 403 });
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.wo);
}
