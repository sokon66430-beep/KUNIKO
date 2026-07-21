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

    // Only existing lines can be corrected; anything else is ignored.
    const edits = grn.items.map((li) => {
      const m = items.find((x) => x.productId === li.productId);
      const qty = m ? Math.max(0, Number(m.qtyReceived) || 0) : li.qtyReceived;
      return { productId: li.productId, qtyReceived: qty };
    });
    const changed = edits.some((e) => {
      const li = grn.items.find((i) => i.productId === e.productId)!;
      return e.qtyReceived !== li.qtyReceived;
    });
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
