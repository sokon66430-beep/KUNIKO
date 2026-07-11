import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

type Skipped = { code?: string; barcode?: string; name?: string; rows?: number; units?: number };

// Build an Excel file of the items a sales import couldn't match (already
// de-duplicated by the importer). The client POSTs the list it received back.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const items: Skipped[] = Array.isArray(body?.items) ? body.items : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Skipped Items", { pageSetup: { fitToPage: true, fitToWidth: 1 } });
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 18 }, { width: 42 }, { width: 12 }, { width: 12 }];

  const HEADER = "FF1E3A8A";
  const title = ws.getCell("A1");
  ws.mergeCells("A1:F1");
  title.value = "SALES IMPORT — SKIPPED ITEMS (not found in products)";
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0C1322" } };
  ws.getRow(1).height = 22;

  const head = ws.getRow(3);
  ["No", "Item Code", "Barcode", "Item Name", "Times seen", "Units"].forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    c.alignment = { horizontal: i >= 4 ? "right" : "left", vertical: "middle" };
    c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });

  items.forEach((it, i) => {
    const r = ws.getRow(4 + i);
    const cells: [any, ("left" | "right")?][] = [
      [i + 1, "right"],
      [it.code || ""],
      [it.barcode || ""],
      [it.name || ""],
      [it.rows ?? "", "right"],
      [it.units ?? "", "right"],
    ];
    cells.forEach(([v, align], c) => {
      const cell = r.getCell(c + 1);
      cell.value = v;
      cell.font = { name: "Calibri", size: 10 };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="skipped-items-${stamp}.xlsx"`,
    },
  });
}
