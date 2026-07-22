import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { mutateMaster } from "@/lib/master";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

// Column aliases (a subset of the product-import template).
const ALIASES: Record<string, string[]> = {
  name: ["product name", "name", "item name"],
  nameKh: ["name kh", "khmer name"],
  barcode: ["default barcodes", "barcode", "barcodes", "default barcode"],
  category: ["category name", "category"],
  cost: ["cost", "unit cost", "cost price"],
  price: ["price", "sell price", "selling price", "retail price"],
  supplierCode: ["supplier code"],
  supplierName: ["supplier name", "supplier"],
  unit: ["default uom", "uom", "unit"],
  sku: ["item id", "item code", "system product code", "sku", "product code"],
  reorderLevel: ["low stock alert", "reorder level", "min stock"],
  ranking: ["product ranking", "ranking"],
  groupCode: ["group code", "product group"],
  shelfLifeDays: ["shelf life (day)", "shelf life (days)", "shelf life"],
};

const num = (v: string) => {
  const n = Number(String(v || "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await masterDataFor(session.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  } catch {
    return NextResponse.json({ error: "Could not read the file — is it a valid .xlsx?" }, { status: 400 });
  }
  const ws = wb.getWorksheet("Products") ?? wb.getWorksheet("Items") ?? wb.worksheets[0];
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

  const maxCol = Math.min(ws.columnCount || 60, 80);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = norm(cellText(r, c));
    const find = (key: string) => {
      for (const alias of ALIASES[key]) {
        const a = norm(alias);
        for (let c = 1; c <= maxCol; c++) if (texts[c] === a) return c;
      }
      return 0;
    };
    if (find("name") && (find("cost") || find("price") || find("barcode") || find("sku"))) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json({ error: 'No header row found — needs a "Product Name" column plus Cost/Price/Barcode/Item ID.' }, { status: 400 });
  }

  type Row = Partial<Record<keyof typeof ALIASES, string>>;
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row: any = {};
    for (const [key, c] of Object.entries(colOf)) row[key] = cellText(r, c);
    if (row.name) rows.push(row);
  }
  if (rows.length === 0) return NextResponse.json({ error: "No product rows found under the header" }, { status: 400 });

  const result = await mutateMaster((products) => {
    const byBarcode = new Map<string, Product>();
    const bySku = new Map<string, Product>();
    const byName = new Map<string, Product>();
    for (const p of products) {
      if (p.barcode) byBarcode.set(p.barcode.replace(/\s+/g, ""), p);
      if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
      byName.set(p.name.toLowerCase().replace(/\s+/g, " ").trim(), p);
    }
    let nextIdNum = products.reduce((max, p) => Math.max(max, parseInt(p.id.slice(1)) || 0), 0) + 1;
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const barcode = (row.barcode || "").replace(/\s+/g, "");
      const sku = (row.sku || "").trim();
      const nameKey = (row.name || "").toLowerCase().replace(/\s+/g, " ").trim();
      // The system product code (SKU) is the product's IDENTITY. When a row
      // carries a code it only ever updates the product with that exact code —
      // never a different product that merely shares a name. The same product
      // name legitimately exists in two forms (e.g. one ready to sell, one that
      // still needs processing) under different codes; importing must keep them
      // separate instead of overwriting one onto the other.
      //
      // Only a row with NO code of its own falls back to barcode, then name, so
      // a simple price list (name + price, no codes) still updates rather than
      // making duplicates.
      let target: Product | undefined;
      if (sku) {
        target = bySku.get(sku.toLowerCase());
      } else if (barcode && byBarcode.get(barcode)) {
        target = byBarcode.get(barcode);
      } else if (nameKey) {
        target = byName.get(nameKey);
      }

      const supplierName = (row.supplierName || "").trim();
      const supplierCode = (row.supplierCode || "").trim();

      if (target) {
        target.name = row.name!;
        if (row.nameKh) target.nameKh = row.nameKh;
        if (barcode) target.barcode = barcode;
        if (row.category && !/^\d+$/.test(row.category.trim())) target.category = row.category;
        if (row.unit) target.unit = row.unit;
        if (row.cost) target.cost = num(row.cost);
        if (row.price) target.price = num(row.price);
        if (row.reorderLevel) target.reorderLevel = num(row.reorderLevel);
        if (row.groupCode) target.groupCode = row.groupCode.toUpperCase();
        if (row.ranking && ["A", "B", "C", "D"].includes(row.ranking.toUpperCase())) target.ranking = row.ranking.toUpperCase() as Product["ranking"];
        if (row.shelfLifeDays) target.shelfLifeDays = num(row.shelfLifeDays) || undefined;
        if (supplierName) target.supplier = supplierName;
        if (supplierCode) target.supplierCode = supplierCode;
        updated++;
      } else {
        const id = `p${String(nextIdNum++).padStart(4, "0")}`;
        const product: Product = {
          id,
          sku: sku || `SKU-${id.slice(1)}`,
          name: row.name!,
          nameKh: row.nameKh || undefined,
          ranking: ["A", "B", "C", "D"].includes((row.ranking || "").toUpperCase()) ? (row.ranking!.toUpperCase() as Product["ranking"]) : "A",
          shelfLifeDays: row.shelfLifeDays ? num(row.shelfLifeDays) || undefined : undefined,
          groupCode: row.groupCode ? row.groupCode.toUpperCase() : undefined,
          category: row.category && !/^\d+$/.test(row.category.trim()) ? row.category : "Uncategorized",
          supplier: supplierName || "—",
          supplierCode: supplierCode || undefined,
          unit: row.unit || "U",
          cost: num(row.cost || "0"),
          price: num(row.price || "0"),
          stock: 0,
          reorderLevel: num(row.reorderLevel || "0"),
          barcode: barcode || undefined,
        };
        products.push(product);
        if (product.barcode) byBarcode.set(product.barcode, product);
        bySku.set(product.sku.toLowerCase(), product);
        byName.set(product.name.toLowerCase().replace(/\s+/g, " ").trim(), product);
        created++;
      }
    }
    return { created, updated, total: products.length };
  });

  return NextResponse.json(result);
}
