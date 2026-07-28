import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { receiptEditOpen, RECEIPT_EDIT_WINDOW_DAYS } from "@/lib/procurement";

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
    // Past the edit window, the receipt is final — no more corrections.
    if (!receiptEditOpen(grn.createdAt)) return { error: "window_closed" as const };

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
    if (result.error === "window_closed")
      return NextResponse.json(
        { error: `This receipt is more than ${RECEIPT_EDIT_WINDOW_DAYS} days old and can no longer be edited. Adjust stock with a stock count or write-off instead.` },
        { status: 400 },
      );
    return NextResponse.json({ error: "No changes to submit" }, { status: 400 });
  }
  return NextResponse.json(result.grn);
}
