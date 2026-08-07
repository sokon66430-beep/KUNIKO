import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { poStatus } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";
import { resolveApprover } from "@/lib/managerAuth";
import { postLedger } from "@/lib/ledger";
import { purchaseUnitCost } from "@/lib/sellingUnits";

export const dynamic = "force-dynamic";

// Approve (or reject) a pending edit to a submitted receipt. The manager proves
// who they are with their approval code; only then does stock move.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim();
  const decision = body?.decision === "reject" ? "reject" : "approve";

  // A session is needed to know WHICH store's manager PINs to check against —
  // this route had none, which is part of why it could only ever compare the
  // Store-Settings badge list. Resolved outside the write window; see the note
  // in resolveApprover.
  const session = await getSession();
  const who = session
    ? await resolveApprover(code, { storeId: session.storeId, purpose: "approveCash" })
    : null;

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return { error: "not_found" as const };
    if (grn.status !== "PendingApproval" || !grn.pendingEdit) {
      return { error: "not_pending" as const };
    }

    if (!who) return { error: "bad_code" as const };

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
      let li = grn.items.find((i) => i.productId === e.productId);
      const newQty = Math.max(0, Number(e.qtyReceived) || 0);

      // A line the receipt never had — it was delivered as zero, or missed.
      // Add it now, taking its name, code and ordered quantity from the order.
      //
      // Only when the correction actually puts something on it: approving an
      // edit that leaves a line at zero must not litter the receipt with rows
      // for goods that never arrived.
      if (!li) {
        if (newQty === 0) continue;
        const poLine = po?.items.find((p) => p.productId === e.productId);
        if (!poLine) continue; // not on the receipt AND not on the order — ignore
        const product = db.products.find((p) => p.id === e.productId);
        li = {
          productId: poLine.productId,
          sku: poLine.sku,
          name: poLine.name,
          qtyOrdered: poLine.qtyOrdered,
          qtyReceived: 0, // set below, so the delta maths is the same as any line
          // Same cost rule as receiving: the case rate when there is one.
          cost: product ? purchaseUnitCost(product) : poLine.cost,
        };
        grn.items.push(li);
      }

      const current = li.qtyReceived;

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
