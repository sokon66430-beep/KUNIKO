import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Request an edit to a submitted receipt. This does NOT change stock — it parks
// the corrected quantities as a pending edit until a manager approves.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const items: { productId: string; qtyReceived: number }[] = Array.isArray(body?.items)
    ? body.items
    : [];

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return { error: "not_found" as const };
    /*
     * NO AGE LIMIT. A receipt of any age can be corrected.
     *
     * There was a two-day window here, guarding against "late, unreviewed
     * edits". The second half of that phrase is the part that stopped being
     * true: an edit does not touch stock. It sets PendingApproval and parks
     * the numbers in `pendingEdit` until a manager approves them, and both the
     * request and the approval are written to the audit log. There is no such
     * thing as an unreviewed edit here, so the window was a second lock on a
     * door that was already locked.
     *
     * What it cost: a supplier query arriving three days after a delivery —
     * which is when queries arrive — left the receiving desk with no way to
     * correct the record. The advice was to fix it with a stock count or a
     * write-off, which moves the quantity but leaves the receipt still saying
     * the wrong thing, so the delivery that was actually short reads as
     * complete forever and the shrink is blamed on the floor.
     */

    // Correctable lines = what the receipt already has, PLUS anything else on
    // the purchase order.
    //
    // A line delivered as zero was never written to the receipt at all, so the
    // correction screen could not show it and there was no way to say "this DID
    // arrive, we missed it" — the receiver's only recourse was a second receipt
    // against the same PO. The order is the list of what was expected, so it is
    // the right list to correct against.
    //
    // Still bounded: a productId on neither the receipt nor the order is
    // ignored, so this cannot invent stock for something never ordered.
    const po = db.purchaseOrders.find((p) => p.id === grn.poId);
    const correctable = new Map<string, number>();
    for (const li of grn.items) correctable.set(li.productId, li.qtyReceived);
    for (const pl of po?.items || []) if (!correctable.has(pl.productId)) correctable.set(pl.productId, 0);

    const edits = [...correctable.entries()].map(([productId, current]) => {
      const m = items.find((x) => x.productId === productId);
      const qty = m ? Math.max(0, Number(m.qtyReceived) || 0) : current;
      return { productId, qtyReceived: qty };
    });
    // A line that isn't on the receipt counts as 0 today, so raising it from 0
    // is a change like any other.
    const changed = edits.some((e) => e.qtyReceived !== (correctable.get(e.productId) ?? 0));
    if (!changed) return { error: "nochange" as const };

    grn.status = "PendingApproval";
    grn.pendingEdit = {
      items: edits,
      requestedBy: body.requestedBy?.trim() || grn.receivedBy || "Receiving Desk",
      requestedAt: new Date().toISOString(),
      note: body.note?.trim() || undefined,
    };
    logAudit(db, {
      actor: grn.pendingEdit.requestedBy,
      action: "Edit requested",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: "Correction awaiting manager approval",
    });
    return { grn };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    return NextResponse.json({ error: "No changes to submit" }, { status: 400 });
  }
  return NextResponse.json(result.grn);
}
