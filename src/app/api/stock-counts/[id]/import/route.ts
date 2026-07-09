import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import type { StockCountItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALIASES: Record<string, string[]> = {
  itemCode: ["item code", "item id", "sku", "product code", "system product code"],
  barcode: ["barcode", "barcode unit", "default barcode", "default barcodes"],
  counted: ["counted qty", "counted", "physical qty", "physical count", "count qty", "actual qty"],
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
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
  const ws = wb.getWorksheet("Stock Count") ?? wb.worksheets[0];
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

  // Find the header row (must have a "Counted Qty" plus an item-code or barcode column).
  const maxCol = Math.min(ws.columnCount || 30, 40);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = cellText(r, c).toLowerCase();
    const find = (key: string) => {
      for (const alias of ALIASES[key]) for (let c = 1; c <= maxCol; c++) if (texts[c] === alias) return c;
      return 0;
    };
    if (find("counted") && (find("itemCode") || find("barcode"))) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json(
      { error: 'No header row found — the sheet needs a "Counted Qty" column plus "Item Code" or "Barcode".' },
      { status: 400 },
    );
  }

  const rows: { itemCode: string; barcode: string; counted: string; rowNum: number }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const counted = colOf.counted ? cellText(r, colOf.counted) : "";
    if (counted === "") continue; // only rows the counter actually filled
    rows.push({
      itemCode: colOf.itemCode ? cellText(r, colOf.itemCode) : "",
      barcode: colOf.barcode ? cellText(r, colOf.barcode) : "",
      counted,
      rowNum: r,
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No counted quantities found in the sheet" }, { status: 400 });
  }

  const session = await getSession();
  const who = session?.name || "Excel import";
  const at = new Date().toISOString();

  const result = await mutateDB((db) => {
    const count = db.stockCounts.find((c) => c.id === params.id);
    if (!count) return { error: "not_found" as const };
    if (count.status === "Posted") return { error: "posted" as const };

    const bySku = new Map(db.products.filter((p) => p.sku).map((p) => [p.sku, p]));
    const byBarcode = new Map<string, typeof db.products>();
    for (const p of db.products) {
      if (p.barcode) (byBarcode.get(p.barcode) ?? byBarcode.set(p.barcode, []).get(p.barcode)!).push(p);
    }

    let updated = 0;
    let added = 0;
    const errors: string[] = [];
    for (const row of rows) {
      let product = row.itemCode ? bySku.get(row.itemCode) : undefined;
      if (!product && row.barcode) {
        const m = byBarcode.get(row.barcode) || [];
        if (m.length === 1) product = m[0];
        else if (m.length > 1) {
          errors.push(`Row ${row.rowNum}: barcode ${row.barcode} matches ${m.length} products — skipped`);
          continue;
        }
      }
      if (!product) {
        errors.push(`Row ${row.rowNum}: no product for ${row.itemCode || row.barcode || "(blank)"} — skipped`);
        continue;
      }
      const qty = Math.max(0, Number(String(row.counted).replace(/[^0-9.\-]/g, "")) || 0);
      const existing = count.items.find((x) => x.productId === product!.id);
      if (existing) {
        existing.countedQty = qty;
        existing.countedBy = who;
        existing.countedAt = at;
        updated++;
      } else {
        const line: StockCountItem = {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          barcode: product.barcode,
          systemQty: product.stock,
          countedQty: qty,
          countedBy: who,
          countedAt: at,
        };
        count.items.push(line);
        added++;
      }
    }

    logAudit(db, {
      actor: count.countedBy,
      action: "Imported",
      entityType: "Count",
      entity: count.countNo,
      detail: `${added} added · ${updated} updated · ${errors.length} skipped`,
    });
    return { added, updated, skipped: errors.length, errors: errors.slice(0, 10), totalRows: rows.length };
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error === "not_found" ? "Count not found" : "This count is already posted" },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json(result);
}
