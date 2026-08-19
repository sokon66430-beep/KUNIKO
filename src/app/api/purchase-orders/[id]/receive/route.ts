import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DATA_DIR } from "@/lib/system";
import { poStatus } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";
import type { GoodsReceipt, GRNItem } from "@/lib/types";
import { purchaseUnitCost } from "@/lib/sellingUnits";

export const dynamic = "force-dynamic";

const INVOICE_DIR = path.join(DATA_DIR, "invoices");

// Receive goods against a PO: bump stock, update received qty, record a GRN.
/**
 * A money amount the client sent, or undefined if it sent nothing usable.
 *
 * Returns undefined rather than 0 for a missing value: 0 is a meaningful
 * answer ("no discount, I checked") and must not be indistinguishable from
 * "the field was never filled in". Negatives are rejected — a negative
 * discount is a surcharge, which is not what this field means.
 */
function money(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

/**
 * A UNIT cost, which is not the same thing as a money total — four decimals,
 * not two.
 *
 * money() above rounds to cents because it validates an invoice's discount and
 * VAT, where cents are the whole unit of account. A per-unit cost is divided
 * out of a case and routinely is not a round cent: a case of 24 at $10.00 is
 * $0.416667 each. Rounding that to $0.42 and multiplying back by 96 gives
 * $40.32 against a $40.00 invoice — the receiver types the right figure, the
 * receipt shows a different one, and nothing says why.
 *
 * That is exactly what this route did for its first draft, because money() was
 * reused for both. Kept separate now, and named for what it validates.
 *
 * The ceiling is a typo guard: a cost is per unit, so a five-figure one is a
 * decimal point in the wrong place rather than a real price, and it would
 * otherwise value the delivery in the millions.
 */
const MAX_UNIT_COST = 100_000;
function unitCost(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_UNIT_COST) return undefined;
  return Math.round(n * 10_000) / 10_000;
}

// The supplier invoice scan is attached here when available; without it the
// receipt is saved but stays INCOMPLETE until the invoice is scanned in.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const lines: { productId: string; qtyReceived: number; unitCost?: unknown }[] = Array.isArray(
    body?.items,
  )
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
    // Once receiving is closed (invoice submitted), the delivery is final — no
    // more goods can be booked against it.
    if (po.receivingClosed) return { error: "closed" as const };

    const receivedBy = body.receivedBy?.trim() || "Receiving Desk";
    const grnItems: GRNItem[] = [];
    /** Lines where receiving keyed a cost the system did not expect. */
    const costCorrections: string[] = [];
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
      // Through the ledger, not a bare += — every movement leaves a line.
      if (product) postLedger(db, product, { type: "RECEIVING", qty: applied, by: receivedBy, ref: po.poNo });

      if (overBy > 0) {
        overReceipts.push(`${poLine.name} +${overBy} over the ${poLine.qtyOrdered} ordered`);
      }

      /*
       * WHAT THIS UNIT COST, and who decided.
       *
       * `expected` is what the system believes: the CASE rate when a case
       * price is set, else the PO's own line. It is a frozen snapshot either
       * way — without one, an old receipt's documents would read the product's
       * price on the day they happen to be opened, so last month's paperwork
       * changes when somebody edits a cost.
       *
       * `keyed` is what the person unloading typed off the invoice, and it
       * WINS. Master Data is wrong on a lot of these products, which is why
       * receiving was slow: the only person who could see the error had
       * nowhere to put it. Validated here rather than trusted — a negative or
       * absurd figure is dropped in favour of the expected one rather than
       * being written into a stock value.
       *
       * WHAT THIS DOES NOT DO is change the product. A receipt is a record of
       * one delivery; repricing the catalogue from a receiving screen would
       * move every margin in the business on one person's typing, with no
       * second pair of eyes. The pair is stored instead, and the owner reviews
       * it — see costWas on GRNItem.
       */
      const expected = product ? purchaseUnitCost(product) : poLine.cost;
      const keyed = unitCost(line.unitCost);
      const corrected = keyed !== undefined && keyed !== expected;
      if (corrected) {
        costCorrections.push(`${poLine.name} ${expected.toFixed(4)} → ${keyed.toFixed(4)}`);
      }

      grnItems.push({
        productId: poLine.productId,
        sku: poLine.sku,
        name: poLine.name,
        qtyOrdered: poLine.qtyOrdered,
        qtyReceived: applied,
        cost: corrected ? keyed : expected,
        ...(corrected ? { costWas: expected } : {}),
      });
    }

    if (grnItems.length === 0) return { error: "empty" as const };

    po.status = poStatus(po);
    // ONE RECEIPT PER PO. Receiving closes the PO immediately — the moment goods
    // are booked against it, it leaves Receiving and locks, so the same delivery
    // can never be received a second time (which used to happen when the first
    // receipt had no invoice and the PO stayed open). The supplier invoice can
    // still be scanned in afterwards from Receipt History, where it attaches to
    // this receipt without re-opening the PO.
    po.receivingClosed = true;
    po.closedAt = new Date().toISOString();
    po.closedBy = receivedBy;

    const n = db.meta.nextGRN++;

    const grn: GoodsReceipt = {
      id: `grn${n}`,
      grnNo: `GRN-${n}`,
      poId: po.id,
      poNo: po.poNo,
      supplier: po.supplier,
      items: grnItems,
      note: body.note?.trim() || undefined,
      // The invoice figures the receiving team keyed in. Kept only when they
      // actually entered something: a 0 discount and an untouched VAT are the
      // computed defaults, and storing those would claim the team confirmed
      // figures they never looked at.
      discount: money(body.discount),
      vatAmount: money(body.vatAmount),
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

    /*
     * A CORRECTED COST GETS ITS OWN AUDIT LINE.
     *
     * Not folded into the "Received" entry above: that one is about goods
     * arriving, which happens every day and is skimmed. A cost the shop
     * believed was wrong is a different kind of event — it is the thing the
     * owner asked to be able to check — and it needs to be findable in the
     * audit trail by itself, naming the product and both figures.
     */
    if (costCorrections.length) {
      logAudit(db, {
        actor: grn.receivedBy,
        action: "Cost corrected at receiving",
        entityType: "GRN",
        entity: grn.grnNo,
        detail: `${po.poNo} · ${costCorrections.join(", ")} — the receipt uses the invoiced figure; Master Data is unchanged`,
      });
    }

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
    if (result.error === "closed")
      return NextResponse.json({ error: "This PO has already been received — a PO can only be received once." }, { status: 400 });
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
