import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

// Column aliases — supports both the ON Mart POS "Items" template
// ("ADD Supplier.xlsx") and simple hand-made sheets.
const ALIASES: Record<string, string[]> = {
  name: ["product name", "name", "item name"],
  barcode: ["default barcodes", "barcode", "barcodes", "default barcode"],
  category: ["category name", "category"],
  cost: ["cost", "unit cost", "cost price", "cost ($)"],
  price: ["price", "sell price", "selling price", "retail price", "price ($)"],
  supplierCode: ["supplier code"],
  supplierName: ["supplier name", "supplier"],
  unit: ["default uom", "uom", "unit"],
  sku: ["system product code", "sku", "product code"],
  stock: ["stock", "qty on hand", "quantity", "on hand", "opening stock"],
  reorderLevel: ["low stock alert", "reorder level", "min stock", "minimum stock"],
  trackStock: ["track stock?", "track stock"],
};

const num = (v: string) => {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};

export async function POST(req: Request) {
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

  // Prefer the POS template's "Items" sheet, else the first sheet.
  const ws = wb.getWorksheet("Items") ?? wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "The workbook has no sheets" }, { status: 400 });

  const cellText = (r: number, c: number) => {
    const cell = ws.getRow(r).getCell(c);
    const t = (cell.text || "").trim();
    // Long numeric cells (barcodes) can render as scientific notation,
    // losing digits — recover the full number from the raw cell value.
    if (/^\d(\.\d+)?e\+\d+$/i.test(t)) {
      const v: any = cell.value;
      const n = typeof v === "number" ? v : v && typeof v === "object" && typeof v.result === "number" ? v.result : NaN;
      if (isFinite(n)) return n.toFixed(0);
    }
    return t;
  };

  // Find the header row: must contain a name column and a cost or price column.
  const maxCol = Math.min(ws.columnCount || 60, 80);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = cellText(r, c).toLowerCase();
    // Earlier aliases win over column position: the POS template has BOTH a
    // (blank) "SKU" column and the real "System Product Code" column, so
    // matching left-to-right would bind sku to the empty column.
    const find = (key: string) => {
      for (const alias of ALIASES[key]) {
        for (let c = 1; c <= maxCol; c++) if (texts[c] === alias) return c;
      }
      return 0;
    };
    if (find("name") && (find("cost") || find("price"))) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json(
      { error: 'No header row found — the sheet needs a "Product Name" (or "Name") column plus "Cost" or "Price".' },
      { status: 400 },
    );
  }

  type Row = Partial<Record<keyof typeof ALIASES, string>> & { rowNum: number };
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row: any = { rowNum: r };
    for (const [key, c] of Object.entries(colOf)) row[key] = cellText(r, c);
    if (row.name) rows.push(row);
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No product rows found under the header" }, { status: 400 });
  }

  const result = await mutateDB((db) => {
    const supByCode = new Map(db.suppliers.map((s) => [s.code, s]));
    const supByName = new Map(db.suppliers.map((s) => [s.name.toLowerCase(), s]));
    const byBarcode = new Map<string, Product[]>();
    const bySku = new Map<string, Product>();
    const byName = new Map<string, Product[]>();
    for (const p of db.products) {
      if (p.barcode) (byBarcode.get(p.barcode) ?? byBarcode.set(p.barcode, []).get(p.barcode)!).push(p);
      if (p.sku) bySku.set(p.sku, p);
      const nameKey = p.name.toLowerCase();
      (byName.get(nameKey) ?? byName.set(nameKey, []).get(nameKey)!).push(p);
    }
    let nextIdNum = db.products.reduce((max, p) => Math.max(max, parseInt(p.id.slice(1)) || 0), 0) + 1;

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      // Resolve the supplier link: code wins, then exact name (canonical master).
      let supplierCode: string | undefined;
      let supplierName: string | undefined;
      if (row.supplierCode && supByCode.has(row.supplierCode)) {
        supplierCode = row.supplierCode;
        supplierName = supByCode.get(row.supplierCode)!.name;
      } else if (row.supplierName && supByName.has(row.supplierName.toLowerCase())) {
        const s = supByName.get(row.supplierName.toLowerCase())!;
        supplierCode = s.code;
        supplierName = s.name;
      } else if (row.supplierName) {
        supplierName = row.supplierName; // free text, unlinked
      }

      // Match an existing product: barcode first (only if unambiguous), then SKU.
      let target: Product | undefined;
      if (row.barcode) {
        const matches = byBarcode.get(row.barcode) || [];
        if (matches.length === 1) target = matches[0];
        else if (matches.length > 1) {
          target = row.sku ? matches.find((m) => m.sku === row.sku) : undefined;
          if (!target) {
            errors.push(`Row ${row.rowNum}: barcode ${row.barcode} matches ${matches.length} products — add a SKU column to disambiguate; skipped`);
            continue;
          }
        }
      }
      if (!target && row.sku) target = bySku.get(row.sku);
      // Last resort: exact name match, only when unambiguous — keeps
      // re-importing the same file idempotent for rows that have neither
      // a usable barcode nor a product code.
      if (!target) {
        const nameMatches = byName.get(row.name!.toLowerCase()) || [];
        if (nameMatches.length === 1) target = nameMatches[0];
      }

      if (target) {
        // Update only the fields present in the sheet — never blank out data
        // just because a column is missing from this particular file.
        target.name = row.name!;
        if (row.barcode) target.barcode = row.barcode;
        if (row.category) target.category = row.category;
        if (row.unit) target.unit = row.unit;
        if (row.cost) target.cost = num(row.cost);
        if (row.price) target.price = num(row.price);
        if (row.stock) target.stock = num(row.stock);
        if (row.reorderLevel) target.reorderLevel = num(row.reorderLevel);
        if (row.trackStock) target.trackStock = row.trackStock.toLowerCase() === "yes";
        if (supplierName) {
          target.supplier = supplierName;
          target.supplierCode = supplierCode;
        }
        updated++;
      } else {
        const id = `p${String(nextIdNum++).padStart(4, "0")}`;
        const product: Product = {
          id,
          sku: row.sku || `SKU-${id.slice(1)}`,
          name: row.name!,
          category: row.category || "Uncategorized",
          supplier: supplierName || "—",
          supplierCode,
          unit: row.unit || "U",
          cost: num(row.cost || "0"),
          price: num(row.price || "0"),
          stock: num(row.stock || "0"),
          reorderLevel: num(row.reorderLevel || "0"),
          barcode: row.barcode || undefined,
          trackStock: (row.trackStock || "").toLowerCase() === "yes",
        };
        db.products.push(product);
        if (product.barcode) (byBarcode.get(product.barcode) ?? byBarcode.set(product.barcode, []).get(product.barcode)!).push(product);
        bySku.set(product.sku, product);
        const nameKey = product.name.toLowerCase();
        (byName.get(nameKey) ?? byName.set(nameKey, []).get(nameKey)!).push(product);
        created++;
      }
    }

    logAudit(db, {
      actor: "Admin",
      action: "Imported",
      entityType: "Product",
      entity: file.name || "Excel file",
      detail: `${created} new · ${updated} updated · ${errors.length} skipped`,
    });
    return { created, updated, skipped: errors.length, errors: errors.slice(0, 10), totalRows: rows.length };
  });

  return NextResponse.json(result);
}
