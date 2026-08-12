import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { DATA_DIR } from "@/lib/system";
import { streamProcurementExport } from "@/lib/procurementExport";

export const dynamic = "force-dynamic";

const INVOICE_DIR = path.join(DATA_DIR, "invoices");

/**
 * Hand this store's purchase records to ON Mart POS.
 *
 * READ ONLY. Nothing here writes, deletes or marks anything — this store keeps
 * working exactly as it did after the file is downloaded, and the export can be
 * taken as many times as it takes to get the import right.
 *
 * ONE STORE PER FILE, always the store the owner is signed in to. Purchase
 * history put into the wrong branch on the far side is invisible afterwards, so
 * the file names its own store and the importer refuses anything it cannot
 * match exactly.
 *
 * THE INVOICE PHOTOGRAPHS TRAVEL WITH IT, as images rather than filenames.
 * A receipt here stores a filename and the picture itself sits in a folder on
 * this server; exporting the name alone would land every historical invoice on
 * the far side pointing at nothing, and an invoice nobody can look at is not
 * evidence. It makes the file considerably larger. That is the right trade.
 *
 * The shape is the contract in ON Mart POS's lib/import/stookii-procurement.ts
 * — `format` and `version` are checked there before anything is read, so a
 * wrong file is refused with a sentence instead of a stack of errors.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  /*
   * `?images=0` — the records without the photographs.
   *
   * The review on the far side is run MORE THAN ONCE: it lists the supplier
   * names it could not match, the owner fixes them, and asks again. That
   * question does not need a single photograph, and answering it should not
   * mean waiting on a hundred-megabyte download over mobile data each time.
   *
   * NOT for the real import. A receipt imported without its pages cannot be
   * given them later by re-running — the second pass sees it is already there
   * and skips it — so the file that is finally committed must be the whole one.
   */
  const withImages = new URL(req.url).searchParams.get("images") !== "0";

  const db = await readDB();
  const system = await readSystem();
  const storeId = session.storeId || "store";
  const storeName = system.stores.find((s) => s.id === storeId)?.name ?? storeId;

  /*
   * Only the pages this store's receipts actually reference.
   *
   * The invoice folder holds every store's pages together, and a file naming
   * one store while carrying another's paperwork is both a privacy problem and
   * a much larger download for no purpose.
   */
  const wanted = new Set<string>();
  for (const grn of db.goodsReceipts ?? []) {
    const inv = grn.invoice;
    if (!inv) continue;
    for (const name of inv.images ?? [inv.image]) if (name) wanted.add(name);
  }

  const records = {
    format: "stookii-procurement" as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    store: { id: storeId, name: storeName },

    /*
     * Requests carry their supplier as a NAME on each line, because that is
     * how this system holds it. The importer matches those names exactly and
     * lists whatever it cannot match rather than guessing.
     */
    purchaseRequests: (db.purchaseRequests ?? []).map((pr) => ({
      id: pr.id,
      prNo: pr.prNo,
      status: pr.status,
      items: pr.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        qty: i.qty,
        cost: i.cost,
        supplier: i.supplier,
      })),
      note: pr.note,
      requestedBy: pr.requestedBy,
      createdAt: pr.createdAt,
      decidedAt: pr.decidedAt,
    })),

    purchaseOrders: (db.purchaseOrders ?? []).map((po) => ({
      id: po.id,
      poNo: po.poNo,
      prNo: po.prNo,
      supplier: po.supplier,
      status: po.status,
      items: po.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        qtyOrdered: i.qtyOrdered,
        qtyReceived: i.qtyReceived,
        cost: i.cost,
        barcode: i.barcode,
      })),
      note: po.note,
      createdAt: po.createdAt,
      createdBy: po.createdBy,
      sentToSupplier: po.sentToSupplier,
      sentAt: po.sentAt,
      /*
       * THE FLAG THAT DECIDES WHETHER THIS SHOWS UP AS A DELIVERY STILL DUE.
       *
       * Receiving here closes an order the moment anything is booked against
       * it, so nearly every order that ever saw goods carries this. ON Mart POS
       * allows a second delivery against the same order, so without this every
       * finished order would arrive there unlocked and sit on its Receiving
       * screen as a delivery that will never come.
       */
      receivingClosed: po.receivingClosed,
      closedAt: po.closedAt,
    })),

    goodsReceipts: (db.goodsReceipts ?? []).map((grn) => ({
      id: grn.id,
      grnNo: grn.grnNo,
      poNo: grn.poNo,
      supplier: grn.supplier,
      items: grn.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        qtyReceived: i.qtyReceived,
        // The cost AS RECEIVED, which this system stored on the line. Exported
        // rather than recomputed: recomputing would price a two-year-old
        // receipt at today's cost and quietly restate history.
        cost: i.cost,
      })),
      note: grn.note,
      discount: grn.discount,
      vatAmount: grn.vatAmount,
      receivedBy: grn.receivedBy,
      createdAt: grn.createdAt,
      invoicePages: grn.invoice ? (grn.invoice.images ?? [grn.invoice.image]).filter(Boolean) : [],
    })),
  };

  const stamp = records.exportedAt.slice(0, 10);
  const safeStore = storeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  /*
   * STREAMED, ONE PAGE AT A TIME — see lib/procurementExport.ts for why, and
   * scripts/test-procurement-export.ts for the proof that the file it writes
   * still parses. This route only decides WHICH pages; the assembly is there
   * because assembling JSON by hand is a silent thing to get wrong.
   */
  const stream = streamProcurementExport(records, withImages ? [...wanted] : [], async (name) => {
    try {
      const bytes = await fs.readFile(path.join(INVOICE_DIR, name));
      const type = name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      return `data:image/${type};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="procurement-${safeStore}${withImages ? "" : "-records-only"}-${stamp}.json"`,
      // Length is unknown up front now, so the browser shows progress rather
      // than a percentage it would have to invent.
      "Cache-Control": "no-store",
    },
  });
}
