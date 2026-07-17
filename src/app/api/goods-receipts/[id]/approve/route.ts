import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { poStatus } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

// Approve (or reject) a pending edit to a submitted receipt. The manager proves
// who they are with their approval code; only then does stock move.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim();
  const decision = body?.decision === "reject" ? "reject" : "approve";

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return { error: "not_found" as const };
    if (grn.status !== "PendingApproval" || !grn.pendingEdit) {
      return { error: "not_pending" as const };
    }

    const approvers = db.meta.business.approvers || [];
    const approver = approvers.find((a) => a.code && a.code === code);
    if (!approver) return { error: "bad_code" as const };
    const who = `${approver.role}${approver.name ? ` (${approver.name})` : ""}`;

    if (decision === "reject") {
      grn.status = "Posted";
      grn.pendingEdit = undefined;
      logAudit(db, { actor: who, action: "Rejected edit", entityType: "GRN", entity: grn.grnNo });
      return { grn };
    }

    // Approve: apply the corrected quantities as stock deltas.
    const po = db.purchaseOrders.find((p) => p.id === grn.poId);
    const changes: string[] = [];
    for (const e of grn.pendingEdit.items) {
      const li = grn.items.find((i) => i.productId === e.productId);
      if (!li) continue;
      const current = li.qtyReceived;
      const newQty = Math.max(0, Number(e.qtyReceived) || 0);

      // The corrected figure is what ARRIVED — it is not clamped to the order.
      //
      // This used to cap at the ordered quantity, which made the correction
      // screen useless for the one case it was most needed: a PO for 5 that a
      // supplier filled with 24. Typing 24 was silently snapped back to 5, so
      // there was no way to tell the system the truth, and the 19 extra units
      // stayed invisible. A receipt records the delivery, not the order.
      if (po) {
        const poLine = po.items.find((p) => p.productId === e.productId);
        if (poLine) {
          const otherReceived = poLine.qtyReceived - current; // from other GRNs
          poLine.qtyReceived = otherReceived + newQty;
        }
      }

      const delta = newQty - current;
      if (delta !== 0) {
        const product = db.products.find((p) => p.id === e.productId);
        // Stock follows the correction exactly — including downwards. Flooring
        // at zero would hide a correction the count needs to reflect. Through
        // the ledger so the receipt edit is a movement on the record.
        if (product) postLedger(db, product, { type: "RECEIVING", qty: delta, by: who, ref: grn.grnNo, note: "receipt corrected" });
        changes.push(`${li.name}: ${current}→${newQty}`);
      }
      li.qtyReceived = newQty;
    }

    if (po) po.status = poStatus(po);
    grn.pendingEdit = undefined;
    grn.status = "Posted";
    logAudit(db, {
      actor: who,
      action: "Approved edit",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: changes.join(" · ") || "no quantity change",
    });
    return { grn };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    if (result.error === "not_pending")
      return NextResponse.json({ error: "This receipt has no pending edit" }, { status: 400 });
    return NextResponse.json({ error: "Invalid approval code" }, { status: 403 });
  }
  return NextResponse.json(result.grn);
}
