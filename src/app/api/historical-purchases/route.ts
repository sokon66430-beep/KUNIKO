import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { findByBarcode } from "@/lib/barcodes";
import { logAudit } from "@/lib/audit";
import type { HistoricalPurchase } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Historical purchases — the old "Stock In Report", kept as history.
//
// Before Stookii, the company never tracked movement; the only record is what
// was bought from suppliers over the years. That total is NOT the shelf (most
// of it sold long ago), so these rows are stored in their own book —
// db.historicalPurchases — with NO code path to product.stock. The inventory
// ledger doesn't even have a type for them; not touching stock is structural,
// not a flag someone can flip.
//
// They exist for purchase analysis: what was bought, from whom, how much.
// The official starting stock comes from the audit team's physical count via
// Opening Inventory instead.
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  barcode: ["barcode", "barcodes", "default barcode"],
  sku: ["item code", "item id", "sku", "product code", "system product code"],
  name: ["product name", "item name", "name", "description"],
  qty: ["quantity", "qty", "qty in", "stock in", "purchased qty", "total qty", "qty purchased"],
  cost: ["cost", "unit cost", "purchase price", "cost price"],
  supplier: ["supplier", "supplier name", "vendor"],
  date: ["date", "purchase date", "stock in date"],
};
const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const num = (v: string) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};

export async function GET() {
  const db = await readDB();
  const list = db.historicalPurchases;
  // Roll-ups the report page needs; raw rows capped so a 50k-line history
  // doesn't ship to the browser on every open.
  const bySupplier = new Map<string, { rows: number; units: number; value: number }>();
  const byProduct = new Map<string, { name: string; units: number; value: number }>();
  for (const h of list) {
    const s = bySupplier.get(h.supplier || "—") ?? { rows: 0, units: 0, value: 0 };
    s.rows++;
    s.units += h.qty;
    s.value += h.qty * (h.cost || 0);
    bySupplier.set(h.supplier || "—", s);
    const key = h.productId || norm(h.name);
    const p = byProduct.get(key) ?? { name: h.name, units: 0, value: 0 };
    p.units += h.qty;
    p.value += h.qty * (h.cost || 0);
    byProduct.set(key, p);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return NextResponse.json({
    total: list.length,
    units: list.reduce((s, h) => s + h.qty, 0),
    value: round2(list.reduce((s, h) => s + h.qty * (h.cost || 0), 0)),
    linked: list.filter((h) => h.productId).length,
    suppliers: [...bySupplier.entries()]
      .map(([name, v]) => ({ name, ...v, value: round2(v.value) }))
      .sort((a, b) => b.value - a.value || b.units - a.units),
    topProducts: [...byProduct.values()]
      .map((p) => ({ ...p, value: round2(p.value) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 50),
    rows: [...list].slice(-500).reverse(),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can import purchase history" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  } catch {
    return NextResponse.json({ error: "Could not read the file — is it a valid .xlsx?" }, { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "The workbook has no sheets" }, { status: 400 });

  const cellText = (r: number, c: number) => {
    const cell = ws.getRow(r).getCell(c);
    let v: any = cell.text;
    if (v && typeof v === "object") v = (cell.value as any)?.result ?? "";
    const t = String(v ?? "").trim();
    if (/^\d(\.\d+)?e\+\d+$/i.test(t) && typeof cell.value === "number") return (cell.value as number).toFixed(0);
    return t;
  };

  const maxCol = Math.min(ws.columnCount || 40, 60);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = normHeader(cellText(r, c));
    const find = (key: string) => {
      for (const a of ALIASES[key]) {
        const n = normHeader(a);
        for (let c = 1; c <= maxCol; c++) if (texts[c] === n) return c;
      }
      return 0;
    };
    if ((find("barcode") || find("sku") || find("name")) && find("qty")) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json(
      { error: 'No header row found — the report needs a product column ("Barcode", "Item Code" or "Product Name") plus a quantity column.' },
      { status: 400 },
    );
  }

  const result = await mutateDB((db) => {
    const byName = new Map(db.products.map((p) => [norm(p.name), p]));
    const bySku = new Map(db.products.map((p) => [p.sku.toLowerCase(), p]));
    let added = 0;
    let unlinked = 0;
    let skipped = 0;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const barcode = colOf.barcode ? cellText(r, colOf.barcode) : "";
      const sku = colOf.sku ? cellText(r, colOf.sku) : "";
      const name = colOf.name ? cellText(r, colOf.name) : "";
      const qty = num(colOf.qty ? cellText(r, colOf.qty) : "");
      if (!barcode && !sku && !name) continue;
      if (/^\s*(grand\s+|sub\s*)?totals?\b/i.test(name) || qty <= 0) {
        skipped++;
        continue;
      }
      const product =
        (barcode && findByBarcode(db.products, barcode)[0]) ||
        (sku && bySku.get(sku.toLowerCase())) ||
        (name && byName.get(norm(name))) ||
        undefined;
      if (!product) unlinked++;
      const h: HistoricalPurchase = {
        id: `hp${db.meta.nextHistorical++}`,
        productId: product?.id,
        barcode: barcode || product?.barcode,
        sku: sku || product?.sku,
        name: name || product?.name || sku || barcode,
        supplier: (colOf.supplier ? cellText(r, colOf.supplier) : "") || product?.supplier || undefined,
        qty,
        cost: colOf.cost ? num(cellText(r, colOf.cost)) || undefined : undefined,
        date: colOf.date ? cellText(r, colOf.date) || undefined : undefined,
        importedAt: new Date().toISOString(),
        file: file.name || "history import",
      };
      db.historicalPurchases.push(h);
      added++;
    }
    logAudit(db, {
      actor: session.name,
      action: "Imported",
      entityType: "Stock",
      entity: "Historical Purchases",
      detail: `${added} rows from ${file.name || "file"} · stock NOT affected${unlinked ? ` · ${unlinked} not matched to the master` : ""}`,
    });
    return { added, unlinked, skipped };
  });

  return NextResponse.json(result);
}

// Clear the history (e.g. a bad file) — the whole point of this book is that
// deleting it cannot touch stock either.
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can clear purchase history" }, { status: 403 });
  }
  const removed = await mutateDB((db) => {
    const n = db.historicalPurchases.length;
    db.historicalPurchases = [];
    logAudit(db, { actor: session.name, action: "Deleted", entityType: "Stock", entity: "Historical Purchases", detail: `${n} rows cleared` });
    return n;
  });
  return NextResponse.json({ removed });
}
