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
   * THREE MODES, because one file does not fit.
   *
   * PDK's full export came to 324MB — the photographs are almost all of it —
   * and the far side cannot take a single upload anywhere near that: it holds
   * the whole thing in a browser tab to parse, then again in one request, on a
   * server with less memory than the file. One 324MB file was never going to
   * arrive whole no matter how carefully this end sent it.
   *
   * So the records and the paper travel separately:
   *
   *   (default)          the records. Small — a few megabytes — and the only
   *                      file needed to review, which is the step run over and
   *                      over while supplier names get fixed.
   *   ?photos=manifest   how many parts the photographs come in, so the page
   *                      can offer exactly that many links.
   *   ?photos=N          one part, sized to arrive.
   *
   * Each photo part carries the RECEIPT NUMBER each page belongs to, not just
   * the filename — that is what lets the far side attach it after the records
   * are already in.
   */
  const params = new URL(req.url).searchParams;
  const photosParam = params.get("photos");

  const db = await readDB();
  const system = await readSystem();
  const storeId = session.storeId || "store";
  const storeName = system.stores.find((s) => s.id === storeId)?.name ?? storeId;

  /*
   * Every page this store's receipts reference, WITH the receipt it belongs
   * to, in a stable order.
   *
   * Stable matters: the parts are worked out by walking this list, so part 3
   * has to mean the same thing on the manifest call and on the download.
   * Sorted by receipt number, then by the page's position in that receipt.
   *
   * Only this store's pages: the invoice folder holds every branch's paperwork
   * together, and shipping another store's invoices would be both a privacy
   * problem and a larger download for no purpose.
   */
  const allPages: { grnNo: string; name: string }[] = [];
  for (const grn of [...(db.goodsReceipts ?? [])].sort((a, b) => a.grnNo.localeCompare(b.grnNo))) {
    const inv = grn.invoice;
    if (!inv) continue;
    for (const name of inv.images ?? [inv.image]) {
      if (name) allPages.push({ grnNo: grn.grnNo, name });
    }
  }

  if (photosParam !== null) {
    return photoResponse(photosParam, allPages, { id: storeId, name: storeName });
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
   * Records only, and STREAMED — see lib/procurementExport.ts for why, and
   * scripts/test-procurement-export.ts for the proof that the file it writes
   * still parses. No pages: the photographs travel as their own parts now,
   * because one file carrying both came to 324MB and could not be uploaded
   * anywhere.
   */
  const stream = streamProcurementExport(records, [], async () => null);

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="procurement-${safeStore}-records-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * How big a photo part is allowed to get, in bytes ON DISK.
 *
 * base64 adds about a third, so 12MB of JPEG lands as roughly 16MB of JSON —
 * comfortably inside the far side's upload ceiling with room for a part that
 * runs slightly over because one page cannot be split.
 */
const PART_BUDGET_BYTES = 12 * 1024 * 1024;

/** Group the pages into parts nobody has to think about. */
async function planParts(
  pages: { grnNo: string; name: string }[],
): Promise<{ parts: { grnNo: string; name: string }[][]; totalBytes: number; missing: number }> {
  const parts: { grnNo: string; name: string }[][] = [];
  let current: { grnNo: string; name: string }[] = [];
  let currentBytes = 0;
  let totalBytes = 0;
  let missing = 0;

  for (const page of pages) {
    let size = 0;
    try {
      size = (await fs.stat(path.join(INVOICE_DIR, page.name))).size;
    } catch {
      // The file is gone. Counted, and left out of the parts entirely — there
      // is nothing to carry, and a part that promised a page it cannot deliver
      // would look like a failed download rather than a gap that already
      // existed here.
      missing++;
      continue;
    }
    totalBytes += size;
    if (current.length > 0 && currentBytes + size > PART_BUDGET_BYTES) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(page);
    currentBytes += size;
  }
  if (current.length) parts.push(current);
  return { parts, totalBytes, missing };
}

async function photoResponse(
  which: string,
  pages: { grnNo: string; name: string }[],
  store: { id: string; name: string },
): Promise<NextResponse> {
  const { parts, totalBytes, missing } = await planParts(pages);

  if (which === "manifest") {
    /* What the Purchase Orders page needs to offer exactly the right number of
       links, and what an owner needs to know before starting: how many files,
       and roughly how much data. */
    return NextResponse.json({
      parts: parts.length,
      pages: parts.reduce((n, p) => n + p.length, 0),
      approxMb: Math.round(((totalBytes * 4) / 3 / (1024 * 1024)) * 10) / 10,
      missingPages: missing,
    });
  }

  const n = Number(which);
  if (!Number.isInteger(n) || n < 1 || n > parts.length) {
    return NextResponse.json(
      { error: `Photo part ${which} does not exist — there ${parts.length === 1 ? "is" : "are"} ${parts.length}.` },
      { status: 404 },
    );
  }

  const mine = parts[n - 1];
  const header = {
    format: "stookii-procurement-photos" as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    store,
    part: n,
    parts: parts.length,
  };

  /*
   * Streamed and pull-driven, exactly as the records are, and for the same
   * reason: this end must never read faster than the download can carry it
   * away. Rebuilt inline rather than reusing streamProcurementExport because
   * the shape differs — each page names the RECEIPT it belongs to, which is
   * what lets the far side attach it to a receipt that is already imported.
   */
  const encoder = new TextEncoder();
  let i = 0;
  let wroteHeader = false;
  /* Tracks whether anything has been written INTO the array — not how many
     pages have been attempted. A page that fails to read writes nothing, so
     counting attempts would put a comma in front of the first page that
     actually lands and produce a file that will not parse. That is precisely
     how the records export broke before it was tested. */
  let wroteFirstPage = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!wroteHeader) {
        wroteHeader = true;
        const head = JSON.stringify(header);
        controller.enqueue(encoder.encode(`${head.slice(0, -1)},"pages":[`));
        return;
      }
      if (i >= mine.length) {
        controller.enqueue(encoder.encode("]}"));
        controller.close();
        return;
      }
      const page = mine[i++];
      try {
        const bytes = await fs.readFile(path.join(INVOICE_DIR, page.name));
        const type = page.name.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        const entry = {
          grnNo: page.grnNo,
          name: page.name,
          dataUrl: `data:image/${type};base64,${bytes.toString("base64")}`,
        };
        controller.enqueue(encoder.encode(`${wroteFirstPage ? "," : ""}${JSON.stringify(entry)}`));
        wroteFirstPage = true;
      } catch {
        // Vanished between planning and reading. Skipped rather than failing
        // the part — the far side records what it received, and a page nobody
        // can produce is a gap on THIS side. Nothing is written, so the comma
        // flag deliberately does not move.
        controller.enqueue(encoder.encode(""));
      }
    },
  });

  const stamp = header.exportedAt.slice(0, 10);
  const safeStore = store.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="procurement-${safeStore}-photos-${n}of${parts.length}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
