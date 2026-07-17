import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { findByBarcode } from "@/lib/barcodes";
import { setStockTo } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";
import type { DB } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Opening Inventory — the migration's one-time starting point.
//
// The audit team physically counts the store; that file is imported here and
// becomes each product's opening balance, posted to the inventory ledger as
// OPENING_BALANCE. Whatever junk figure stock held before (old imports, sync
// artifacts) is discarded — the entry's qty is the true delta so the ledger
// still sums, and the note records what was thrown away.
//
// Owner-only: this rewrites stock wholesale, once. A product that already has
// an OPENING_BALANCE line refuses a second one — later corrections belong to
// stock counts, which leave an adjustment trail, not a fresh "beginning".
//
// Upload xlsx or csv with columns (any order, case-insensitive):
//   Barcode · Product Name (fallback match) · Quantity · Store (optional)
// Two-phase: POST ?mode=preview validates and returns per-row results without
// writing; ?mode=commit applies the valid rows and reports the failed ones.
// Failures never block the valid rows — the response carries both, and the
// failed list downloads as CSV client-side for fixing and re-upload.
// ---------------------------------------------------------------------------

type RowResult = {
  row: number;
  barcode: string;
  name: string;
  qty: number;
  issue?: string; // absent = valid
  matchedName?: string; // what the barcode resolved to, so a mismatch is visible
  prevStock?: number;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function parseCsv(text: string): string[][] {
  // Simple CSV: quoted fields with commas/quotes, CRLF tolerant. Enough for a
  // count export; a workbook should be uploaded as .xlsx.
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const ALIASES: Record<string, string[]> = {
  barcode: ["barcode", "barcodes", "default barcode"],
  name: ["product name", "item name", "name"],
  qty: ["quantity", "qty", "counted qty", "count", "qty counted"],
  store: ["store", "branch", "store name", "location"],
};
const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function readRows(file: File): Promise<{ header: Record<string, number>; rows: { cells: string[]; rowNum: number }[] } | { error: string }> {
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  let grid: string[][];
  if (isCsv) {
    grid = parseCsv(Buffer.from(await file.arrayBuffer()).toString("utf8"));
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
    } catch {
      return { error: "Could not read the file — is it a valid .xlsx or .csv?" };
    }
    const ws = wb.worksheets[0];
    if (!ws) return { error: "The workbook has no sheets" };
    grid = [];
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        let v: any = c.text;
        if (v && typeof v === "object") v = (c.value as any)?.result ?? "";
        // Excel renders long numeric barcodes as scientific notation ("6.48E+11");
        // recover the digits from the raw numeric value.
        const t = String(v ?? "").trim();
        if (/^\d(\.\d+)?e\+\d+$/i.test(t) && typeof c.value === "number") v = c.value.toFixed(0);
        cells[col - 1] = String(v ?? "").trim();
      });
      grid.push(cells);
    });
  }
  // Find the header row (first 10 rows) — needs barcode-or-name plus quantity.
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const texts = grid[r].map((c) => normHeader(c || ""));
    const find = (key: string) => {
      for (const a of ALIASES[key]) {
        const n = normHeader(a);
        const idx = texts.indexOf(n);
        if (idx !== -1) return idx;
      }
      return -1;
    };
    const header: Record<string, number> = {};
    for (const key of Object.keys(ALIASES)) {
      const idx = find(key);
      if (idx !== -1) header[key] = idx;
    }
    if ((header.barcode != null || header.name != null) && header.qty != null) {
      return { header, rows: grid.slice(r + 1).map((cells, i) => ({ cells, rowNum: r + i + 2 })) };
    }
  }
  return { error: 'No header row found — the file needs a "Barcode" (or "Product Name") column plus a "Quantity" column.' };
}

function validate(db: DB, storeName: string, header: Record<string, number>, rows: { cells: string[]; rowNum: number }[]): RowResult[] {
  const byName = new Map(db.products.map((p) => [norm(p.name), p]));
  const openingDone = new Set(db.ledger.filter((l) => l.type === "OPENING_BALANCE").map((l) => l.productId));
  const seen = new Map<string, number>(); // barcode/name → first row that used it
  const results: RowResult[] = [];

  for (const { cells, rowNum } of rows) {
    const barcode = (header.barcode != null ? cells[header.barcode] : "") || "";
    const name = (header.name != null ? cells[header.name] : "") || "";
    const qtyText = (header.qty != null ? cells[header.qty] : "") || "";
    const store = (header.store != null ? cells[header.store] : "") || "";
    if (!barcode && !name && !qtyText) continue; // blank row

    const res: RowResult = { row: rowNum, barcode, name, qty: Number(qtyText.replace(/[^0-9.\-]/g, "")) };

    const dupKey = (barcode || norm(name)).toLowerCase();
    if (seen.has(dupKey)) {
      res.issue = `Duplicate of row ${seen.get(dupKey)} — one row per product`;
      results.push(res);
      continue;
    }
    seen.set(dupKey, rowNum);

    if (!isFinite(res.qty) || qtyText.trim() === "") {
      res.issue = "Missing or unreadable quantity";
      results.push(res);
      continue;
    }
    if (res.qty < 0) {
      res.issue = "Quantity cannot be negative";
      results.push(res);
      continue;
    }
    if (store && norm(store) !== norm(storeName)) {
      res.issue = `Row is for store "${store}" — switch to that store and import it there`;
      results.push(res);
      continue;
    }

    let product = barcode ? findByBarcode(db.products, barcode)[0] : undefined;
    if (!product && name) product = byName.get(norm(name));
    if (!product) {
      res.issue = "No product with this barcode/name in the Product Master";
      results.push(res);
      continue;
    }
    if (barcode && findByBarcode(db.products, barcode).length > 1) {
      res.issue = "Barcode matches more than one product — fix the master first";
      results.push(res);
      continue;
    }
    if (openingDone.has(product.id)) {
      res.issue = "Opening balance already posted for this product — use a stock count to correct it";
      results.push(res);
      continue;
    }
    res.matchedName = product.name;
    res.prevStock = product.stock;
    results.push(res);
  }
  return results;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can import opening inventory" }, { status: 403 });
  }

  const mode = new URL(req.url).searchParams.get("mode") === "commit" ? "commit" : "preview";
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const parsed = await readRows(file);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (mode === "preview") {
    const db = await readDB();
    const results = validate(db, session.storeName, parsed.header, parsed.rows);
    const failed = results.filter((r) => r.issue);
    return NextResponse.json({
      mode,
      total: results.length,
      valid: results.length - failed.length,
      failed: failed.length,
      rows: results,
    });
  }

  const result = await mutateDB((db) => {
    // Re-validate inside the write lock — the preview's answer may be stale.
    const results = validate(db, session.storeName, parsed.header, parsed.rows);
    let applied = 0;
    let units = 0;
    for (const r of results) {
      if (r.issue) continue;
      const product =
        (r.barcode && findByBarcode(db.products, r.barcode)[0]) ||
        db.products.find((p) => norm(p.name) === norm(r.name));
      if (!product) continue;
      setStockTo(db, product, r.qty, {
        type: "OPENING_BALANCE",
        by: session.name,
        ref: file.name || "opening import",
        note: product.stock !== 0 ? `prior figure ${product.stock} discarded` : undefined,
      });
      applied++;
      units += r.qty;
    }
    logAudit(db, {
      actor: session.name,
      action: "Imported",
      entityType: "Stock",
      entity: "Opening Inventory",
      detail: `${applied} products opened at ${units} units from ${file.name || "file"} · ${
        results.filter((x) => x.issue).length
      } row(s) failed`,
    });
    return { results, applied, units };
  });

  const failed = result.results.filter((r) => r.issue);
  return NextResponse.json({
    mode,
    total: result.results.length,
    valid: result.applied,
    failed: failed.length,
    units: result.units,
    rows: result.results,
  });
}
