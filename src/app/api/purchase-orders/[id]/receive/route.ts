import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { poStatus } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { GoodsReceipt, GRNItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Receive goods against a PO: bump stock, update received qty, record a GRN.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const lines: { productId: string; qtyReceived: number }[] = Array.isArray(body?.items)
    ? body.items
    : [];

  const result = await mutateDB((db) => {
    const po = db.purchaseOrders.find((p) => p.id === params.id);
    if (!po) return { error: "not_found" as const };
    if (po.status === "Cancelled") return { error: "cancelled" as const };

    const grnItems: GRNItem[] = [];
    for (const line of lines) {
      const qty = Math.max(0, Number(line.qtyReceived) || 0);
      if (qty === 0) continue;
      const poLine = po.items.find((i) => i.productId === line.productId);
      if (!poLine) continue;
      // Cap to the outstanding quantity so a mis-scan / typo (e.g. 1000 for a
      // 10-unit line) can't over-receive and silently inflate stock.
      const remaining = Math.max(0, poLine.qtyOrdered - poLine.qtyReceived);
      const applied = Math.min(qty, remaining);
      if (applied === 0) continue;
      poLine.qtyReceived += applied;

      const product = db.products.find((p) => p.id === line.productId);
      if (product) product.stock += applied; // stock updates on every scan

      grnItems.push({
        productId: poLine.productId,
        sku: poLine.sku,
        name: poLine.name,
        qtyOrdered: poLine.qtyOrdered,
        qtyReceived: applied,
      });
    }

    if (grnItems.length === 0) return { error: "empty" as const };

    po.status = poStatus(po);

    const n = db.meta.nextGRN++;
    const grn: GoodsReceipt = {
      id: `grn${n}`,
      grnNo: `GRN-${n}`,
      poId: po.id,
      poNo: po.poNo,
      supplier: po.supplier,
      items: grnItems,
      note: body.note?.trim() || undefined,
      receivedBy: body.receivedBy?.trim() || "Receiving Desk",
      createdAt: new Date().toISOString(),
    };
    db.goodsReceipts.push(grn);
    logAudit(db, {
      actor: grn.receivedBy,
      action: "Received",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: `${po.poNo} · +${grnItems.reduce((s, i) => s + i.qtyReceived, 0)} units`,
    });
    return { grn, po };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (result.error === "cancelled")
      return NextResponse.json({ error: "This PO is cancelled" }, { status: 400 });
    return NextResponse.json({ error: "Nothing to receive" }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
