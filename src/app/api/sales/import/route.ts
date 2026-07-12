import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import ExcelJS from "exceljs";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { Sale, SaleItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Import historical sales from a spreadsheet so reports and order recommendations
// reflect real selling history. Expected columns (any order, case-insensitive):
//   Date · Item Code (or Barcode) · Qty · Price (optional)
// Rows are grouped by date into one sale per day. Stock is NOT changed — this is
// historical data, not a live sale.
const ALIASES: Record<string, string[]> = {
  date: ["date", "sale date", "sold date", "invoice date"],
  sku: ["item code", "item id", "sku", "product code", "system product code"],
  barcode: ["barcode", "barcodes", "default barcodes", "default barcode"],
  name: ["item name", "product name", "name"],
  qty: ["qty", "quantity", "units", "qty sold", "units sold"],
  price: ["price", "unit price", "sell price", "selling price"],
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};

// Best-effort date parse → yyyy-mm-dd. Accepts Excel Date cells and common text.
function toDayKey(cellValue: any, text: string): string | null {
  if (cellValue instanceof Date && !isNaN(cellValue.getTime())) return cellValue.toISOString().slice(0, 10);
  const t = (text || "").trim();
  if (!t) return null;
  // yyyy-mm-dd or yyyy/mm/dd
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // dd/mm/yyyy or dd-mm-yyyy (day first — the shop's local convention)
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const actor = await currentActor();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  } catch {
    return NextResponse.json({ error: "Could not read the file — is it a valid .xlsx?" }, { status: 400 });
  }
  const ws = wb.getWorksheet("Sales") ?? wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "The workbook has no sheets" }, { status: 400 });

  const cellText = (r: number, c: number) => {
    const cell = ws.getRow(r).getCell(c);
    const t = (cell.text || "").trim();
    if (/^\d(\.\d+)?e\+\d+$/i.test(t)) {
      const v: any = cell.value;
      const n = typeof v === "number" ? v : v && typeof v === "object" && typeof v.result === "number" ? v.result : NaN;
      if (isFinite(n)) return n.toFixed(0);
    }
    return t;
  };

  const maxCol = Math.min(ws.columnCount || 40, 60);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = cellText(r, c).toLowerCase();
    const find = (key: string) => {
      for (const alias of ALIASES[key]) for (let c = 1; c <= maxCol; c++) if (texts[c] === alias) return c;
      return 0;
    };
    // Need a product identifier + a quantity to count a sale.
    if ((find("sku") || find("barcode") || find("name")) && find("qty")) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json(
      { error: 'No header row found — the sheet needs an "Item Code" (or "Barcode") column plus a "Qty" column.' },
      { status: 400 },
    );
  }

  type Row = { day: string | null; sku: string; barcode: string; name: string; qty: number; price: number; rowNum: number };
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const dateCell = colOf.date ? ws.getRow(r).getCell(colOf.date).value : null;
    const qty = colOf.qty ? num(cellText(r, colOf.qty)) : 0;
    const sku = colOf.sku ? cellText(r, colOf.sku) : "";
    const barcode = colOf.barcode ? cellText(r, colOf.barcode) : "";
    const name = colOf.name ? cellText(r, colOf.name) : "";
    if (qty <= 0 || (!sku && !barcode && !name)) continue;
    rows.push({
      day: toDayKey(dateCell, colOf.date ? cellText(r, colOf.date) : ""),
      sku,
      barcode,
      name,
      qty,
      price: colOf.price ? num(cellText(r, colOf.price)) : 0,
      rowNum: r,
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No sale rows found under the header" }, { status: 400 });
  }

  const result = await mutateDB((db) => {
    const byBarcode = new Map<string, any>();
    const bySku = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const p of db.products) {
      if (p.barcode) byBarcode.set(p.barcode, p);
      if (p.sku) bySku.set(p.sku.toLowerCase(), p);
      byName.set(p.name.toLowerCase(), p);
    }

    // Group rows into one sale per day (undated rows fall under "today").
    const today = new Date().toISOString().slice(0, 10);
    const byDay = new Map<string, SaleItem[]>();
    let matched = 0;
    const errors: string[] = [];
    // Skipped items, de-duplicated: one entry per unique code/barcode/name, with
    // how many times it appeared and the total units that couldn't be counted.
    const skippedMap = new Map<string, { code: string; barcode: string; name: string; rows: number; units: number }>();

    for (const row of rows) {
      const p =
        (row.barcode && byBarcode.get(row.barcode)) ||
        (row.sku && bySku.get(row.sku.toLowerCase())) ||
        (row.name && byName.get(row.name.toLowerCase()));
      if (!p) {
        errors.push(`Row ${row.rowNum}: no product for ${row.sku || row.barcode || row.name}; skipped`);
        const key = (row.barcode || row.sku || row.name).toLowerCase();
        const ex = skippedMap.get(key);
        if (ex) {
          ex.rows += 1;
          ex.units += row.qty;
        } else {
          skippedMap.set(key, { code: row.sku, barcode: row.barcode, name: row.name, rows: 1, units: row.qty });
        }
        continue;
      }
      const day = row.day || today;
      const items = byDay.get(day) ?? byDay.set(day, []).get(day)!;
      items.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        qty: row.qty,
        price: row.price || p.price,
        cost: p.cost,
      });
      matched++;
    }

    let salesCreated = 0;
    for (const [day, items] of byDay) {
      if (items.length === 0) continue;
      const subtotal = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
      const cost = round2(items.reduce((s, it) => s + it.cost * it.qty, 0));
      const tax = round2(subtotal * db.meta.business.vatRate);
      const total = round2(subtotal + tax);
      const invoiceNo = `INV-${db.meta.nextInvoice}`;
      const sale: Sale = {
        id: `s${db.meta.nextInvoice}`,
        invoiceNo,
        items,
        customerId: null,
        subtotal,
        discount: 0,
        tax,
        total,
        cost,
        profit: round2(subtotal - cost),
        paymentMethod: "Cash",
        createdAt: new Date(`${day}T12:00:00`).toISOString(),
        imported: true,
      };
      db.meta.nextInvoice += 1;
      db.sales.push(sale);
      salesCreated++;
    }

    logAudit(db, {
      actor,
      action: "Imported",
      entityType: "Sale",
      entity: file.name || "Excel file",
      detail: `${matched} lines · ${salesCreated} day-sales · ${errors.length} skipped`,
    });
    const skippedItems = [...skippedMap.values()].sort((a, b) => b.rows - a.rows);
    return {
      matched,
      salesCreated,
      skipped: skippedItems.length, // unique items skipped (deduped)
      skippedRows: errors.length, // total rows skipped
      skippedItems,
      totalRows: rows.length,
    };
  });

  return NextResponse.json(result);
}
