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
// The supplier invoice scan is attached here when available; without it the
// receipt is saved but stays INCOMPLETE until the invoice is scanned in.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const lines: { productId: string; qtyReceived: number }[] = Array.isArray(body?.items)
    ? body.items
    : [];

  // Optional invoice — one or more pages. Accepts `invoices: string[]`
  // (multi-page) or a single `invoice: string` (back-compat). Each is a
  // JPEG/PNG data URL.
  const rawPages: string[] = Array.isArray(body.invoices)
    ? body.invoices.filter((x: any) => typeof x === "string")
    : typeof body.invoice === "string" && body.invoice
      ? [body.invoice]
      : [];
  const invoiceBufs: Buffer[] = [];
  for (const url of rawPages) {
    const mm = url.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!mm) continue;
    const b = Buffer.from(mm[2], "base64");
    if (b.length > 8_000_000) {
      return NextResponse.json({ error: "An invoice page is too large (max 8 MB each)." }, { status: 400 });
    }
    invoiceBufs.push(b);
  }
  const hasInvoice = invoiceBufs.length > 0;

  const session = await getSession();
  const storeId = session?.storeId || "store";

  const result = await mutateDB((db) => {
    const po = db.purchaseOrders.find((p) => p.id === params.id);
    if (!po) return { error: "not_found" as const };
    if (po.status === "Cancelled") return { error: "cancelled" as const };

    const grnItems: GRNItem[] = [];
    // Lines where more arrived than was ordered — recorded, then reported to the
    // audit trail so a genuine mis-scan is still traceable after the fact.
    const overReceipts: string[] = [];
    for (const line of lines) {
      const qty = Math.max(0, Number(line.qtyReceived) || 0);
      if (qty === 0) continue;
      const poLine = po.items.find((i) => i.productId === line.productId);
      if (!poLine) continue;

      // Record what ACTUALLY arrived — including more than was ordered.
      //
      // This used to cap at the outstanding quantity, to stop a mis-scan
      // inflating stock. The cap did real damage instead: a supplier delivering
      // 24 against an order of 5 had 19 units silently dropped. Stock rose by 5,
      // the receipt said 5, and the other 19 were on the shelf but existed
      // nowhere in the system — the kind of gap that only turns up at a stock
      // count, with nothing to explain it.
      //
      // A receipt is a record of what came off the truck, not a re-statement of
      // the order. The mis-scan case is answered where it belongs: the receiver
      // sees "over N" in red on the line before confirming, and an over-receipt
      // is written to the audit trail below.
      const applied = qty;
      const overBy = Math.max(0, poLine.qtyReceived + applied - poLine.qtyOrdered);
      poLine.qtyReceived += applied;

      const product = db.products.find((p) => p.id === line.productId);
      if (product) product.stock += applied; // stock updates on every scan

      if (overBy > 0) {
        overReceipts.push(`${poLine.name} +${overBy} over the ${poLine.qtyOrdered} ordered`);
      }

      grnItems.push({
        productId: poLine.productId,
        sku: poLine.sku,
        name: poLine.name,
        qtyOrdered: poLine.qtyOrdered,
        qtyReceived: applied,
        // The unit cost AS RECEIVED. Without it the receipt has no cost of its
        // own and its documents read the product's price of the day they're
        // opened — so last month's receipt quietly changes when a cost does.
        cost: poLine.cost,
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
      // Attached only when the invoice was scanned; otherwise the receipt is
      // incomplete until /api/goods-receipts/[id]/invoice adds it. Multi-page
      // invoices store one file per page.
      invoice: hasInvoice
        ? (() => {
            const images = invoiceBufs.map((_, i) => `${storeId}-grn${n}-p${i + 1}.jpg`);
            return { image: images[0], images, uploadedBy: receivedBy, status: "Pending" as const };
          })()
        : undefined,
    };
    db.goodsReceipts.push(grn);
    logAudit(db, {
      actor: grn.receivedBy,
      action: "Received",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: `${po.poNo} · +${grnItems.reduce((s, i) => s + i.qtyReceived, 0)} units`,
    });

    // An over-delivery is legitimate but worth a trail — it's also what a
    // mis-scan looks like, and this is how one gets found later.
    if (overReceipts.length) {
      logAudit(db, {
        actor: grn.receivedBy,
        action: "Over-received",
        entityType: "GRN",
        entity: grn.grnNo,
        detail: `${po.poNo} · more arrived than ordered — ${overReceipts.join(", ")}`,
      });
    }
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
  if (hasInvoice && result.grn.invoice) {
    try {
      await fs.mkdir(INVOICE_DIR, { recursive: true });
      const names = result.grn.invoice.images || [result.grn.invoice.image];
      await Promise.all(names.map((name, i) => fs.writeFile(path.join(INVOICE_DIR, name), invoiceBufs[i])));
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json(result, { status: 201 });
}
