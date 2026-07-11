import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DATA_DIR } from "@/lib/system";
import { poStatus } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { GoodsReceipt, GRNItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const INVOICE_DIR = path.join(DATA_DIR, "invoices");

// Receive goods against a PO: bump stock, update received qty, record a GRN.
// A photo/scan of the supplier's invoice is REQUIRED — it's stored and queued
// for Accounting to review (approve / reject).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const lines: { productId: string; qtyReceived: number }[] = Array.isArray(body?.items)
    ? body.items
    : [];

  // Validate + decode the invoice image (a JPEG/PNG data URL from the client).
  const invoiceDataUrl: string = typeof body.invoice === "string" ? body.invoice : "";
  const m = invoiceDataUrl.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) {
    return NextResponse.json(
      { error: "Invoice photo is required — scan or photograph the supplier's invoice before submitting." },
      { status: 400 },
    );
  }
  const invoiceBuf = Buffer.from(m[2], "base64");
  if (invoiceBuf.length > 8_000_000) {
    return NextResponse.json({ error: "Invoice image is too large (max 8 MB)." }, { status: 400 });
  }

  const session = await getSession();
  const storeId = session?.storeId || "store";

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
    const receivedBy = body.receivedBy?.trim() || "Receiving Desk";
    const grn: GoodsReceipt = {
      id: `grn${n}`,
      grnNo: `GRN-${n}`,
      poId: po.id,
      poNo: po.poNo,
      supplier: po.supplier,
      items: grnItems,
      note: body.note?.trim() || undefined,
      receivedBy,
      createdAt: new Date().toISOString(),
      invoice: {
        image: `${storeId}-grn${n}.jpg`,
        uploadedBy: receivedBy,
        status: "Pending",
      },
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

  // Persist the invoice image next to the store data (best-effort: the receipt
  // stands even if the disk write fails; the viewer shows a missing-image note).
  try {
    await fs.mkdir(INVOICE_DIR, { recursive: true });
    await fs.writeFile(path.join(INVOICE_DIR, result.grn.invoice!.image), invoiceBuf);
  } catch {
    /* ignore */
  }
  return NextResponse.json(result, { status: 201 });
}
