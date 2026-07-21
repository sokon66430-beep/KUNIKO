import ExcelJS from "exceljs";
import type { PurchaseOrder, PurchaseRequest, GoodsReceipt, StockCount, WriteOff, Product, Sale, DB } from "./types";
import { formatLocations } from "./location";

type Business = DB["meta"]["business"];

const CALIBRI = "Calibri";
const ARIAL = "Arial";
const TAHOMA = "Tahoma";
const MONEY = '"$"#,##0.00';

const thin: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } };
const medium: ExcelJS.Border = { style: "medium", color: { argb: "FF000000" } };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };

function ddmmyyyy(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function hhmm(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Columns shared by the write-off Excel and CSV exports.
export const WRITE_OFF_COLUMNS: { header: string; get: (w: WriteOff) => string | number }[] = [
  { header: "Date", get: (w) => ddmmyyyy(w.createdAt) },
  { header: "Time", get: (w) => hhmm(w.createdAt) },
  { header: "Barcode", get: (w) => w.barcode || "" },
  { header: "SKU", get: (w) => w.sku },
  { header: "Product", get: (w) => w.productName },
  { header: "Category", get: (w) => w.category },
  { header: "Quantity", get: (w) => w.quantity },
  { header: "Unit", get: (w) => w.unit },
  { header: "Reason", get: (w) => w.reason },
  { header: "Notes", get: (w) => w.notes || "" },
  { header: "User", get: (w) => w.createdBy },
];

const COLW = [13, 19.45, 58.54, 10.18, 10.82, 10.18, 15.45, 28.54, 15.18];

// ---------------------------------------------------------------------------
// Purchase Order — reproduces the ON Mart "PR-Form" (Autoshine) layout: title,
// SUPPLIER/PO NUMBER header block, bordered line table with live formulas,
// Subtotal/VAT/GRAND TOTAL (yellow), notes, and a signature box.
// ---------------------------------------------------------------------------
export function buildPOWorkbook(
  po: PurchaseOrder,
  business: Business,
  vatRate: number = business.vatRate ?? 0.1,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PR-Form", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  ws.columns = COLW.map((width) => ({ width }));

  ws.mergeCells("A1:I1");
  const title = ws.getCell("A1");
  title.value = "PURCHASE ORDER";
  title.font = { name: CALIBRI, size: 26, bold: true, color: { argb: "FF000000" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 40;

  const headerLabel = (addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: CALIBRI, size: 11, bold: true, color: { argb: "FF000000" } };
  };
  const headerValue = (addr: string, text: string, bold = false) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: CALIBRI, size: 11, bold, color: { argb: "FF000000" } };
  };

  headerLabel("A3", "SUPPLIER");
  ws.mergeCells("B3:D3");
  headerValue("B3", po.supplier, true);
  headerLabel("G3", "PO NUMBER");
  ws.mergeCells("H3:I3");
  headerValue("H3", po.poNo);

  headerLabel("A4", "BRANCH");
  ws.mergeCells("B4:D4");
  headerValue("B4", business.branch);
  headerLabel("G4", "ORDER DATE");
  ws.mergeCells("H4:I4");
  headerValue("H4", ddmmyyyy(po.createdAt));

  headerLabel("A5", "SHIP TO");
  ws.mergeCells("B5:D5");
  headerValue("B5", business.shipTo);
  headerLabel("G5", "EST. ARRIVAL");
  ws.mergeCells("H5:I5");
  headerValue("H5", ddmmyyyy(po.expectedDate));

  headerLabel("A6", "RECEIVED BY");
  ws.mergeCells("B6:D6");
  headerValue("B6", business.receivedBy);
  headerLabel("G6", "Requested By");
  ws.mergeCells("H6:I6");
  headerValue("H6", business.authorizedBy);

  // Line-item table
  const HEAD_ROW = 8;
  const headers = [
    "NO", "BARCODE UNIT", "ITEM NAME", "UOM (SIZE)", "QTY(Units)", "UOM Type",
    "Unit Price (EX VAT)", "Box Price (EX VAT)", "Amount",
  ];
  const headRow = ws.getRow(HEAD_ROW);
  headRow.height = 32;
  headers.forEach((h, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: CALIBRI, size: 13, bold: true, color: { argb: "FF000000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: medium,
      bottom: thin,
      left: i === 0 ? medium : thin,
      right: i === headers.length - 1 ? medium : thin,
    };
  });

  const firstDataRow = HEAD_ROW + 1;
  po.items.forEach((it, idx) => {
    const r = ws.getRow(firstDataRow + idx);
    r.height = 22;
    const set = (col: number, value: unknown, font: string, align: ExcelJS.Alignment["horizontal"], fmt?: string) => {
      const cell = r.getCell(col);
      cell.value = value as ExcelJS.CellValue;
      cell.font = { name: font, size: font === ARIAL ? 10 : font === TAHOMA ? 11 : 13, color: { argb: "FF000000" } };
      cell.alignment = { horizontal: align, vertical: "middle", wrapText: font === ARIAL };
      cell.border = { ...allThin, left: col === 1 ? medium : thin, right: col === 9 ? medium : thin };
      if (fmt) cell.numFmt = fmt;
    };
    set(1, idx + 1, CALIBRI, "center");
    set(2, it.barcode || "", ARIAL, "center");
    set(3, it.name, ARIAL, "left");
    set(4, it.uomSize || "-", CALIBRI, "center");
    set(5, it.qtyOrdered, TAHOMA, "center");
    set(6, it.unit || "unit", CALIBRI, "center");
    set(7, it.cost, CALIBRI, "right", MONEY);
    set(8, "-", CALIBRI, "center");
    const amountCell = r.getCell(9);
    amountCell.value = { formula: `G${firstDataRow + idx}*E${firstDataRow + idx}` };
    amountCell.font = { name: CALIBRI, size: 13, color: { argb: "FF000000" } };
    amountCell.alignment = { horizontal: "right", vertical: "middle" };
    amountCell.numFmt = MONEY;
    amountCell.border = { ...allThin, left: thin, right: medium };
  });

  const lastDataRow = firstDataRow + po.items.length - 1;
  const totalsStart = lastDataRow + 1;
  const totalRows: { label: string; formula: string; yellow?: boolean }[] = [
    { label: "Subtotal (EX VAT)", formula: `SUM(I${firstDataRow}:I${lastDataRow})` },
    { label: `VAT (${Math.round(vatRate * 100)}%)`, formula: `I${totalsStart}*${vatRate}` },
    { label: "GRAND TOTAL", formula: `SUM(I${totalsStart}:I${totalsStart + 1})`, yellow: true },
  ];
  totalRows.forEach((t, i) => {
    const rowIdx = totalsStart + i;
    const r = ws.getRow(rowIdx);
    const labelCell = r.getCell(8);
    labelCell.value = t.label;
    labelCell.font = { name: CALIBRI, size: 14, bold: true, color: { argb: "FF000000" } };
    labelCell.border = allThin;
    if (t.yellow) labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    const valueCell = r.getCell(9);
    valueCell.value = { formula: t.formula };
    valueCell.font = { name: CALIBRI, size: 13, bold: true, color: { argb: "FF000000" } };
    valueCell.alignment = { horizontal: "right" };
    valueCell.numFmt = MONEY;
    valueCell.border = { ...allThin, right: medium };
    if (t.yellow) valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  });

  // Notes (Arial)
  let row = totalsStart + totalRows.length + 2;
  const notesTitle = ws.getCell(`A${row}`);
  notesTitle.value = "Notes:";
  notesTitle.font = { name: ARIAL, size: 14, bold: true, color: { argb: "FF000000" } };
  row++;
  // On a tax-free PO the price-basis note (#3) switches from "EX VAT … added
  // separately" to "IN VAT" (prices are quoted VAT-inclusive).
  const poNotes = (business.poNotes || []).map((n) =>
    vatRate === 0 && /ex vat/i.test(n)
      ? `${n.match(/^\s*\d+\.\s*/)?.[0] || ""}Prices are IN VAT, VAT 10%`
      : n,
  );
  const noteLines = [...poNotes, ...(business.invoiceTo || [])];
  noteLines.forEach((line, i) => {
    ws.mergeCells(`A${row}:I${row}`);
    const cell = ws.getCell(`A${row}`);
    cell.value = business.poNotes?.length && i === business.poNotes.length ? `4. ${line}` : line;
    cell.font = { name: ARIAL, size: 14, color: { argb: "FF000000" } };
    row++;
  });

  // Signature box
  row += 1;
  const boxTop = row;
  const boxBottom = row + 6;
  ws.mergeCells(`A${boxTop}:C${boxBottom}`);
  ws.mergeCells(`D${boxTop}:F${boxTop}`);
  ws.mergeCells(`G${boxTop}:I${boxTop}`);
  const remark = ws.getCell(`A${boxTop}`);
  remark.value = "Remark:";
  remark.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FF000000" } };
  remark.alignment = { horizontal: "left", vertical: "top" };

  const approved = ws.getCell(`D${boxTop}`);
  approved.value = "APPROVED BY";
  approved.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FF000000" } };

  const received = ws.getCell(`G${boxTop}`);
  received.value = "RECEIVED BY";
  received.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FF000000" } };

  const sigRow = boxTop + 3;
  ws.mergeCells(`D${sigRow}:F${sigRow}`);
  ws.mergeCells(`G${sigRow}:I${sigRow}`);
  [`D${sigRow}`, `G${sigRow}`].forEach((addr) => {
    const c = ws.getCell(addr);
    c.value = "Signature";
    c.font = { name: CALIBRI, size: 9, color: { argb: "FF000000" } };
    c.alignment = { horizontal: "center" };
    c.border = { top: thin };
  });

  const nameRow = sigRow + 1;
  ["D", "G"].forEach((col) => {
    const c = ws.getCell(`${col}${nameRow}`);
    c.value = "Name:";
    c.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FF000000" } };
  });
  const dateRow = nameRow + 1;
  ["D", "G"].forEach((col) => {
    const c = ws.getCell(`${col}${dateRow}`);
    c.value = "Date:";
    c.font = { name: CALIBRI, size: 10, color: { argb: "FF000000" } };
  });

  // Outer border for the whole signature box
  for (let r = boxTop; r <= boxBottom; r++) {
    ws.getCell(`A${r}`).border = { ...ws.getCell(`A${r}`).border, left: medium };
    ws.getCell(`I${r}`).border = { ...ws.getCell(`I${r}`).border, right: medium };
  }
  for (let c = 1; c <= 9; c++) {
    const colLetter = ws.getColumn(c).letter;
    ws.getCell(`${colLetter}${boxTop}`).border = { ...ws.getCell(`${colLetter}${boxTop}`).border, top: medium };
    ws.getCell(`${colLetter}${boxBottom}`).border = { ...ws.getCell(`${colLetter}${boxBottom}`).border, bottom: medium };
  }
  ws.getCell(`D${boxTop}`).border = { ...ws.getCell(`D${boxTop}`).border, left: medium };
  ws.getCell(`G${boxTop}`).border = { ...ws.getCell(`G${boxTop}`).border, left: medium };

  return wb;
}

// ---------------------------------------------------------------------------
// Purchase Request — same visual language, adapted fields (no supplier VAT
// breakdown since it's an internal request, not yet a priced supplier order).
// ---------------------------------------------------------------------------
export function buildPRWorkbook(pr: PurchaseRequest, business: Business): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PR-Form", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  ws.columns = [13, 19.45, 58.54, 10.18, 10.82, 15.45, 15.18].map((width) => ({ width }));

  ws.mergeCells("A1:G1");
  const title = ws.getCell("A1");
  title.value = "PURCHASE REQUEST";
  title.font = { name: CALIBRI, size: 26, bold: true, color: { argb: "FF000000" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 40;

  const headerLabel = (addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: CALIBRI, size: 11, bold: true, color: { argb: "FF000000" } };
  };
  const headerValue = (addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: CALIBRI, size: 11, color: { argb: "FF000000" } };
  };

  headerLabel("A3", "REQUESTED BY");
  ws.mergeCells("B3:C3");
  headerValue("B3", pr.requestedBy);
  headerLabel("E3", "PR NUMBER");
  ws.mergeCells("F3:G3");
  headerValue("F3", pr.prNo);

  headerLabel("A4", "BRANCH");
  ws.mergeCells("B4:C4");
  headerValue("B4", business.branch);
  headerLabel("E4", "DATE");
  ws.mergeCells("F4:G4");
  headerValue("F4", ddmmyyyy(pr.createdAt));

  headerLabel("A5", "NOTE");
  ws.mergeCells("B5:C5");
  headerValue("B5", pr.note || "-");
  headerLabel("E5", "STATUS");
  ws.mergeCells("F5:G5");
  headerValue("F5", pr.status);

  const HEAD_ROW = 7;
  const headers = ["NO", "BARCODE", "ITEM NAME", "SUPPLIER", "QTY", "Est. Unit Cost", "Est. Amount"];
  const headRow = ws.getRow(HEAD_ROW);
  headRow.height = 30;
  headers.forEach((h, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: CALIBRI, size: 13, bold: true, color: { argb: "FF000000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: medium, bottom: thin, left: i === 0 ? medium : thin, right: i === headers.length - 1 ? medium : thin };
  });

  const firstDataRow = HEAD_ROW + 1;
  pr.items.forEach((it, idx) => {
    const r = ws.getRow(firstDataRow + idx);
    r.height = 22;
    const set = (col: number, value: unknown, font: string, align: ExcelJS.Alignment["horizontal"], fmt?: string) => {
      const cell = r.getCell(col);
      cell.value = value as ExcelJS.CellValue;
      cell.font = { name: font, size: font === ARIAL ? 10 : 12, color: { argb: "FF000000" } };
      cell.alignment = { horizontal: align, vertical: "middle", wrapText: font === ARIAL };
      cell.border = { ...allThin, left: col === 1 ? medium : thin, right: col === 7 ? medium : thin };
      if (fmt) cell.numFmt = fmt;
    };
    set(1, idx + 1, CALIBRI, "center");
    set(2, it.barcode || "", ARIAL, "center");
    set(3, it.name, ARIAL, "left");
    set(4, it.supplier, CALIBRI, "left");
    set(5, it.qty, CALIBRI, "center");
    set(6, it.cost, CALIBRI, "right", MONEY);
    const amountCell = r.getCell(7);
    amountCell.value = { formula: `F${firstDataRow + idx}*E${firstDataRow + idx}` };
    amountCell.font = { name: CALIBRI, size: 12, color: { argb: "FF000000" } };
    amountCell.alignment = { horizontal: "right" };
    amountCell.numFmt = MONEY;
    amountCell.border = { ...allThin, right: medium };
  });

  const lastDataRow = firstDataRow + pr.items.length - 1;
  const totalRow = lastDataRow + 1;
  const labelCell = ws.getCell(`F${totalRow}`);
  labelCell.value = "Est. Total";
  labelCell.font = { name: CALIBRI, size: 14, bold: true, color: { argb: "FF000000" } };
  labelCell.border = allThin;
  const valueCell = ws.getCell(`G${totalRow}`);
  valueCell.value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
  valueCell.font = { name: CALIBRI, size: 13, bold: true, color: { argb: "FF000000" } };
  valueCell.alignment = { horizontal: "right" };
  valueCell.numFmt = MONEY;
  valueCell.border = { ...allThin, right: medium };

  let row = totalRow + 3;
  ["Requested By", "Approved By"].forEach((role, i) => {
    const col = i === 0 ? "A" : "E";
    const endCol = i === 0 ? "C" : "G";
    ws.mergeCells(`${col}${row}:${endCol}${row}`);
    const c = ws.getCell(`${col}${row}`);
    c.value = role;
    c.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FF000000" } };
  });
  row += 3;
  ["A", "E"].forEach((col) => {
    const c = ws.getCell(`${col}${row}`);
    c.value = "Signature: ____________________   Date: __________";
    c.font = { name: CALIBRI, size: 10, color: { argb: "FF000000" } };
  });

  return wb;
}

// ---------------------------------------------------------------------------
// Report workbooks — one summary row per document, with a totals line.
// ---------------------------------------------------------------------------
const HEADER_FILL = "FF1F5FF5"; // brand-600
const round2 = (n: number) => Math.round(n * 100) / 100;

function reportHeader(ws: ExcelJS.Worksheet, title: string, meta: string[], colCount: number) {
  const lastCol = ws.getColumn(colCount).letter;
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { name: CALIBRI, size: 18, bold: true, color: { argb: "FF0C1322" } };
  ws.getRow(1).height = 26;
  meta.forEach((line, i) => {
    ws.mergeCells(`A${2 + i}:${lastCol}${2 + i}`);
    const c = ws.getCell(`A${2 + i}`);
    c.value = line;
    c.font = { name: CALIBRI, size: 10, color: { argb: "FF64748B" } };
  });
  return 2 + meta.length + 1; // first table row (header)
}

function tableHead(ws: ExcelJS.Worksheet, row: number, headers: { label: string; align?: "right" | "center" }[]) {
  const r = ws.getRow(row);
  r.height = 20;
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h.label;
    cell.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: h.align || "left", vertical: "middle", wrapText: true };
    cell.border = allThin;
  });
}

export function buildPOReportWorkbook(
  pos: PurchaseOrder[],
  business: Business,
  filterNote: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PO Report", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  ws.columns = [
    { width: 6 }, { width: 18 }, { width: 12 }, { width: 34 }, { width: 8 },
    { width: 11 }, { width: 11 }, { width: 14 }, { width: 12 },
  ];

  const genLine = `${business.name} · ${business.branch}`;
  let row = reportHeader(ws, "PURCHASE ORDER REPORT", [genLine, filterNote], 9);

  tableHead(ws, row, [
    { label: "No" }, { label: "PO Number" }, { label: "Date" }, { label: "Supplier" },
    { label: "Items", align: "center" }, { label: "Qty Ordered", align: "right" },
    { label: "Qty Received", align: "right" }, { label: "Value (EX VAT)", align: "right" },
    { label: "Status", align: "center" },
  ]);

  const firstDataRow = row + 1;
  let grand = 0;
  pos.forEach((po, i) => {
    const r = ws.getRow(firstDataRow + i);
    const ordered = po.items.reduce((s, it) => s + it.qtyOrdered, 0);
    const received = po.items.reduce((s, it) => s + it.qtyReceived, 0);
    const value = round2(po.items.reduce((s, it) => s + it.cost * it.qtyOrdered, 0));
    grand += value;
    const cells: [ExcelJS.CellValue, ("right" | "center" | "left")?, string?][] = [
      [i + 1, "center"], [po.poNo], [ddmmyyyy(po.createdAt), "center"], [po.supplier],
      [po.items.length, "center"], [ordered, "right"], [received, "right"],
      [value, "right", MONEY], [po.status, "center"],
    ];
    cells.forEach(([val, align, fmt], c) => {
      const cell = r.getCell(c + 1);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      cell.border = allThin;
      if (fmt) cell.numFmt = fmt;
    });
  });

  const totalRow = firstDataRow + pos.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(7);
  lbl.value = "TOTAL";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const val = tr.getCell(8);
  val.value = round2(grand);
  val.numFmt = MONEY;
  val.font = { name: CALIBRI, size: 11, bold: true };
  val.alignment = { horizontal: "right" };
  val.border = allThin;
  tr.getCell(9).border = allThin;

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}

export function buildPRReportWorkbook(prs: PurchaseRequest[], business: Business, filterNote: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PR Report", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  ws.columns = [
    { width: 6 }, { width: 16 }, { width: 12 }, { width: 20 }, { width: 8 },
    { width: 15 }, { width: 12 }, { width: 30 },
  ];

  let row = reportHeader(ws, "PURCHASE REQUEST REPORT", [`${business.name} · ${business.branch}`, filterNote], 8);

  tableHead(ws, row, [
    { label: "No" }, { label: "PR Number" }, { label: "Date" }, { label: "Requested By" },
    { label: "Items", align: "center" }, { label: "Est. Value", align: "right" },
    { label: "Status", align: "center" }, { label: "Note" },
  ]);

  const firstDataRow = row + 1;
  let grand = 0;
  prs.forEach((pr, i) => {
    const r = ws.getRow(firstDataRow + i);
    const value = round2(pr.items.reduce((s, it) => s + it.cost * it.qty, 0));
    grand += value;
    const cells: [ExcelJS.CellValue, ("right" | "center" | "left")?, string?][] = [
      [i + 1, "center"], [pr.prNo], [ddmmyyyy(pr.createdAt), "center"], [pr.requestedBy],
      [pr.items.length, "center"], [value, "right", MONEY], [pr.status, "center"], [pr.note || ""],
    ];
    cells.forEach(([val, align, fmt], c) => {
      const cell = r.getCell(c + 1);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      cell.border = allThin;
      if (fmt) cell.numFmt = fmt;
    });
  });

  const totalRow = firstDataRow + prs.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(5);
  lbl.value = "TOTAL";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const val = tr.getCell(6);
  val.value = round2(grand);
  val.numFmt = MONEY;
  val.font = { name: CALIBRI, size: 11, bold: true };
  val.alignment = { horizontal: "right" };
  val.border = allThin;

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}

export function buildGRNReportWorkbook(
  grns: GoodsReceipt[],
  products: Product[],
  business: Business,
  filterNote: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Receiving Report", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  const vatRate = business.vatRate ?? 0.1;
  // No · Date · Time · GRN · PO · Supplier · Item Code · Barcode · Item Name · Cost · VAT · Sell · Qty · Line Cost
  ws.columns = [
    { width: 5 }, { width: 12 }, { width: 8 }, { width: 15 }, { width: 16 }, { width: 26 },
    { width: 12 }, { width: 15 }, { width: 34 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 7 }, { width: 13 },
  ];

  const prodById = new Map(products.map((p) => [p.id, p]));
  let row = reportHeader(ws, "GOODS RECEIVING REPORT", [`${business.name} · ${business.branch}`, filterNote], 14);

  tableHead(ws, row, [
    { label: "No" }, { label: "Date" }, { label: "Time" }, { label: "GRN No" }, { label: "PO Number" }, { label: "Supplier" },
    { label: "Item Code" }, { label: "Barcode" }, { label: "Item Name" },
    { label: "Cost", align: "right" }, { label: `VAT ${Math.round(vatRate * 100)}%`, align: "right" },
    { label: "Sell Price", align: "right" }, { label: "Qty", align: "right" }, { label: "Line Cost", align: "right" },
  ]);

  // Flatten to one row per received item, enriched with barcode + cost.
  const lineRows = grns.flatMap((g) =>
    g.items.map((it) => {
      const p = prodById.get(it.productId);
      // The cost AS RECEIVED (see GRNItem.cost) — a receipt must not re-price
      // itself when the product's cost changes later. Older receipts have no
      // snapshot, so they fall back to the product's current cost.
      // Rounded BEFORE multiplying, so the printed cost × qty is the printed
      // line total and the sheet reconciles by hand.
      const cost = round2(it.cost ?? p?.cost ?? 0);
      return {
        date: ddmmyyyy(g.createdAt),
        time: hhmm(g.createdAt),
        grnNo: g.grnNo,
        poNo: g.poNo,
        supplier: g.supplier,
        sku: it.sku,
        barcode: p?.barcode || "",
        name: it.name,
        cost,
        vat: round2(cost * vatRate),
        sell: round2(p?.price ?? 0),
        qty: it.qtyReceived,
        lineCost: round2(cost * it.qtyReceived),
      };
    }),
  );

  const firstDataRow = row + 1;
  let grandQty = 0;
  let grandCost = 0;
  let grandVat = 0;
  lineRows.forEach((li, i) => {
    const r = ws.getRow(firstDataRow + i);
    grandQty += li.qty;
    grandCost += li.lineCost;
    // VAT total is the per-unit VAT times the quantity received — the real tax
    // on the whole line, not the per-unit figure shown in the column.
    grandVat += round2(li.vat * li.qty);
    const cells: [ExcelJS.CellValue, ("right" | "center" | "left")?, string?][] = [
      [i + 1, "center"], [li.date, "center"], [li.time, "center"], [li.grnNo], [li.poNo], [li.supplier],
      [li.sku], [li.barcode], [li.name],
      [round2(li.cost), "right", MONEY], [round2(li.vat), "right", MONEY], [round2(li.sell), "right", MONEY],
      [li.qty, "right"], [li.lineCost, "right", MONEY],
    ];
    cells.forEach(([val, align, fmt], c) => {
      const cell = r.getCell(c + 1);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      if (fmt) cell.numFmt = fmt;
      cell.border = allThin;
    });
  });

  const totalRow = firstDataRow + lineRows.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(9);
  lbl.value = "TOTAL";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const qCell = tr.getCell(13);
  qCell.value = grandQty;
  qCell.font = { name: CALIBRI, size: 11, bold: true };
  qCell.alignment = { horizontal: "right" };
  qCell.border = allThin;
  const cCell = tr.getCell(14);
  cCell.value = round2(grandCost);
  cCell.numFmt = MONEY;
  cCell.font = { name: CALIBRI, size: 11, bold: true };
  cCell.alignment = { horizontal: "right" };
  cCell.border = allThin;
  // border the gap cells (Cost · VAT · Sell) for a clean total band
  tr.getCell(10).border = allThin;
  tr.getCell(11).border = allThin;
  tr.getCell(12).border = allThin;

  // Money summary below the table — total cost (ex-VAT), the total VAT and the
  // grand total including VAT, so the sheet reconciles against the supplier
  // invoice's own subtotal / tax / grand-total lines.
  const summary: [string, number, boolean?][] = [
    ["Total cost (ex-VAT)", round2(grandCost)],
    [`Total VAT ${Math.round(vatRate * 100)}%`, round2(grandVat)],
    ["Grand total (incl. VAT)", round2(grandCost + grandVat), true],
  ];
  summary.forEach(([label, value, strong], i) => {
    const sr = ws.getRow(totalRow + 1 + i);
    // Label spans the wide middle so long text ("Grand total (incl. VAT)") fits.
    ws.mergeCells(`I${totalRow + 1 + i}:M${totalRow + 1 + i}`);
    const lc = sr.getCell(9);
    lc.value = label;
    lc.font = { name: CALIBRI, size: strong ? 11 : 10, bold: !!strong, color: { argb: "FF0C1322" } };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    const vc = sr.getCell(14);
    vc.value = value;
    vc.numFmt = MONEY;
    vc.font = { name: CALIBRI, size: strong ? 11 : 10, bold: true, color: { argb: "FF0C1322" } };
    vc.alignment = { horizontal: "right", vertical: "middle" };
    vc.border = allThin;
    if (strong) vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
  });

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}

// ---------------------------------------------------------------------------
// Write-Off export — one row per record, with a totals line.
// ---------------------------------------------------------------------------
export function buildWriteOffWorkbook(
  writeoffs: WriteOff[],
  business: Business,
  filterNote: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Write-Offs", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 6 }, { width: 12 }, { width: 8 }, { width: 16 }, { width: 13 }, { width: 34 },
    { width: 18 }, { width: 10 }, { width: 8 }, { width: 15 }, { width: 26 }, { width: 16 },
  ];

  let row = reportHeader(ws, "WRITE-OFF REPORT", [`${business.name} · ${business.branch}`, filterNote], WRITE_OFF_COLUMNS.length + 1);
  tableHead(ws, row, [
    { label: "No" },
    ...WRITE_OFF_COLUMNS.map((c) => ({ label: c.header, align: c.header === "Quantity" ? ("right" as const) : undefined })),
  ]);

  const firstDataRow = row + 1;
  let totalQty = 0;
  writeoffs.forEach((w, i) => {
    const r = ws.getRow(firstDataRow + i);
    totalQty += w.quantity;
    const noCell = r.getCell(1);
    noCell.value = i + 1;
    noCell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
    noCell.alignment = { horizontal: "center", vertical: "middle" };
    noCell.border = allThin;
    WRITE_OFF_COLUMNS.forEach((c, ci) => {
      const cell = r.getCell(ci + 2);
      cell.value = c.get(w) as ExcelJS.CellValue;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.header === "Quantity" ? "right" : "left", vertical: "middle" };
      cell.border = allThin;
    });
  });

  const totalRow = firstDataRow + writeoffs.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(7);
  lbl.value = "TOTAL QTY";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const val = tr.getCell(8);
  val.value = round2(totalQty);
  val.font = { name: CALIBRI, size: 11, bold: true };
  val.alignment = { horizontal: "right" };
  val.border = allThin;

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}

// ---------------------------------------------------------------------------
// Product master export — round-trips with the import (same column headers), so
// you can export, edit suppliers/prices in Excel, and re-import to update.
// Empty supplier cells are highlighted yellow so gaps are easy to spot & fill.
// ---------------------------------------------------------------------------
export function buildProductsWorkbook(products: Product[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Item ID", key: "sku", width: 14 },
    { header: "Barcode", key: "barcode", width: 18 },
    { header: "Product Name", key: "name", width: 42 },
    { header: "Name KH", key: "nameKh", width: 30 },
    { header: "Category", key: "category", width: 22 },
    { header: "Location(s)", key: "locations", width: 18 },
    { header: "Unit", key: "unit", width: 8 },
    { header: "Supplier Code", key: "supplierCode", width: 14 },
    { header: "Supplier Name", key: "supplierName", width: 30 },
    { header: "Cost", key: "cost", width: 10 },
    { header: "Price", key: "price", width: 10 },
    { header: "Stock", key: "stock", width: 8 },
    { header: "Low Stock Alert", key: "reorderLevel", width: 14 },
    { header: "Product Ranking", key: "ranking", width: 14 },
    { header: "Shelf Life (day)", key: "shelfLifeDays", width: 13 },
    { header: "Group Code", key: "groupCode", width: 11 },
  ];

  const head = ws.getRow(1);
  head.height = 20;
  head.eachCell((c) => {
    c.font = { name: CALIBRI, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { horizontal: "left", vertical: "middle" };
    c.border = allThin;
  });

  products.forEach((p, idx) => {
    const r = ws.addRow({
      no: idx + 1,
      sku: p.sku,
      barcode: p.barcode || "",
      name: p.name,
      nameKh: p.nameKh || "",
      category: p.category || "",
      locations: formatLocations(p),
      unit: p.unit || "",
      supplierCode: p.supplierCode || "",
      supplierName: p.supplier && p.supplier !== "—" ? p.supplier : "",
      cost: p.cost,
      price: p.price,
      stock: p.stock,
      reorderLevel: p.reorderLevel,
      ranking: p.ranking || "A",
      shelfLifeDays: p.shelfLifeDays ?? "",
      groupCode: p.groupCode || "",
    });
    r.eachCell((c) => {
      c.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      c.border = allThin;
    });
    // Highlight the two supplier cells when the product isn't linked yet.
    // By column key so it can't drift when columns are inserted.
    if (!p.supplierCode) {
      const yellow = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFF9C4" } };
      r.getCell(ws.getColumn("supplierCode").number).fill = yellow;
      r.getCell(ws.getColumn("supplierName").number).fill = yellow;
    }
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb;
}

// ---------------------------------------------------------------------------
// Sales report workbook — three sheets from the same filtered sales:
//   1. Invoices    — one row per sale (matches the old single-sheet export)
//   2. By Item     — units, revenue (& profit) aggregated per product
//   3. By Category — the same, rolled up to category
// Aggregation mirrors /api/sales-report exactly (revenue = price·qty,
// cost = cost·qty, profit = revenue − cost) so the figures match the on-screen
// Sales Report. Cost/Profit columns are dropped entirely when showProfit=false.
// ---------------------------------------------------------------------------
type SalesCol = {
  label: string;
  align?: "right" | "center" | "left";
  money?: boolean;
  num?: boolean;
  total?: boolean; // summed into the TOTAL row
  width: number;
};

function salesSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  title: string,
  meta: string[],
  cols: SalesCol[],
  rows: ExcelJS.CellValue[][],
) {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  let row = reportHeader(ws, title, meta, cols.length);
  tableHead(
    ws,
    row,
    cols.map((c) => ({ label: c.label, align: c.align === "left" ? undefined : c.align })),
  );

  const firstDataRow = row + 1;
  const totals = cols.map(() => 0);
  rows.forEach((cells, i) => {
    const r = ws.getRow(firstDataRow + i);
    cols.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      const val = cells[ci];
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
      cell.border = allThin;
      if (c.money) cell.numFmt = MONEY;
      else if (c.num) cell.numFmt = "#,##0";
      if (c.total && typeof val === "number") totals[ci] += val;
    });
  });

  // TOTAL row
  const totalRow = firstDataRow + rows.length;
  const tr = ws.getRow(totalRow);
  cols.forEach((c, ci) => {
    const cell = tr.getCell(ci + 1);
    if (ci === 0) cell.value = "TOTAL";
    else if (c.total) {
      cell.value = c.money ? round2(totals[ci]) : totals[ci];
      cell.numFmt = c.money ? MONEY : "#,##0";
    }
    cell.font = { name: CALIBRI, size: 11, bold: true, color: { argb: "FF0C1322" } };
    cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
    cell.border = allThin;
  });

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
}

export function buildSalesReportWorkbook(
  sales: Sale[],
  products: Product[],
  business: Business,
  filterNote: string,
  showProfit = true,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const meta = [`${business.name} · ${business.branch}`, filterNote];
  const profitCols: SalesCol[] = showProfit
    ? [
        { label: "Cost", align: "right", money: true, total: true, width: 12 },
        { label: "Profit", align: "right", money: true, total: true, width: 12 },
      ]
    : [];

  // --- Sheet 1: Invoices (one row per sale) --------------------------------
  const invCols: SalesCol[] = [
    { label: "No", align: "center", width: 6 },
    { label: "Date", align: "center", width: 12 },
    { label: "Time", align: "center", width: 8 },
    { label: "Invoice", width: 14 },
    { label: "Customer", width: 20 },
    { label: "Items", align: "right", num: true, total: true, width: 8 },
    { label: "Subtotal", align: "right", money: true, total: true, width: 12 },
    { label: "Discount", align: "right", money: true, total: true, width: 12 },
    { label: "Tax", align: "right", money: true, total: true, width: 11 },
    { label: "Total", align: "right", money: true, total: true, width: 13 },
    ...profitCols,
    { label: "Payment", align: "center", width: 12 },
  ];
  const invRows: ExcelJS.CellValue[][] = sales.map((s, i) => [
    i + 1,
    ddmmyyyy(s.createdAt),
    hhmm(s.createdAt),
    s.invoiceNo,
    s.customerName || "Walk-in",
    s.items.length,
    round2(s.subtotal),
    round2(s.discount),
    round2(s.tax),
    round2(s.total),
    ...(showProfit ? [round2(s.cost), round2(s.profit)] : []),
    s.paymentMethod,
  ]);
  salesSheet(wb, "Invoices", "SALES REPORT — INVOICES", meta, invCols, invRows);

  // --- Aggregate item + category figures (mirrors /api/sales-report) -------
  const catOf = new Map(products.map((p) => [p.id, p.category] as const));
  const barcodeOf = new Map(products.map((p) => [p.id, p.barcode || ""] as const));
  type Agg = { qty: number; revenue: number; cost: number };
  const items = new Map<string, Agg & { sku: string; name: string; category: string; barcode: string }>();
  const cats = new Map<string, Agg & { category: string; products: Set<string> }>();
  for (const sale of sales) {
    for (const it of sale.items) {
      const category = catOf.get(it.productId) || "Uncategorized";
      const revenue = it.price * it.qty;
      const cost = it.cost * it.qty;
      const ie =
        items.get(it.productId) ??
        items
          .set(it.productId, {
            sku: it.sku,
            name: it.name,
            category,
            barcode: barcodeOf.get(it.productId) || "",
            qty: 0,
            revenue: 0,
            cost: 0,
          })
          .get(it.productId)!;
      ie.qty += it.qty;
      ie.revenue += revenue;
      ie.cost += cost;
      const ce =
        cats.get(category) ??
        cats.set(category, { category, products: new Set(), qty: 0, revenue: 0, cost: 0 }).get(category)!;
      ce.qty += it.qty;
      ce.revenue += revenue;
      ce.cost += cost;
      ce.products.add(it.productId);
    }
  }

  // --- Sheet 2: By Item (best-selling first) -------------------------------
  const byItem = [...items.values()].sort((a, b) => b.qty - a.qty);
  const itemCols: SalesCol[] = [
    { label: "No", align: "center", width: 6 },
    { label: "Item Code", width: 14 },
    { label: "Barcode", width: 16 },
    { label: "Item Name", width: 40 },
    { label: "Category", width: 22 },
    { label: "Qty Sold", align: "right", num: true, total: true, width: 10 },
    { label: "Revenue", align: "right", money: true, total: true, width: 13 },
    ...profitCols,
  ];
  const itemRows: ExcelJS.CellValue[][] = byItem.map((it, i) => [
    i + 1,
    it.sku,
    it.barcode,
    it.name,
    it.category,
    it.qty,
    round2(it.revenue),
    ...(showProfit ? [round2(it.cost), round2(it.revenue - it.cost)] : []),
  ]);
  salesSheet(wb, "By Item", "SALES REPORT — BY ITEM", meta, itemCols, itemRows);

  // --- Sheet 3: By Category (top revenue first) ----------------------------
  const byCat = [...cats.values()].sort((a, b) => b.revenue - a.revenue);
  const catCols: SalesCol[] = [
    { label: "No", align: "center", width: 6 },
    { label: "Category", width: 30 },
    { label: "Products", align: "right", num: true, total: true, width: 10 },
    { label: "Qty Sold", align: "right", num: true, total: true, width: 10 },
    { label: "Revenue", align: "right", money: true, total: true, width: 14 },
    ...profitCols,
  ];
  const catRows: ExcelJS.CellValue[][] = byCat.map((c, i) => [
    i + 1,
    c.category,
    c.products.size,
    c.qty,
    round2(c.revenue),
    ...(showProfit ? [round2(c.cost), round2(c.revenue - c.cost)] : []),
  ]);
  salesSheet(wb, "By Category", "SALES REPORT — BY CATEGORY", meta, catCols, catRows);

  return wb;
}

// ---------------------------------------------------------------------------
// Product Sales report — one row per product sold in the range, with units
// sold, revenue, VAT (each product's share of the basket VAT), and — for roles
// allowed to see it — cost (COGS) and profit. Drives the /reports "Export
// Excel" button. VAT always shows; cost/profit follow the profit permission.
// ---------------------------------------------------------------------------
export type ProductSalesRow = {
  name: string;
  sku: string;
  qty: number;
  revenue: number;
  vat: number;
  cost: number;
  profit: number;
  margin: number;
};

export function buildProductSalesWorkbook(
  rows: ProductSalesRow[],
  business: Business,
  filterNote: string,
  showProfit = true,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const meta = [`${business.name} · ${business.branch}`, filterNote];
  const cols: SalesCol[] = [
    { label: "No", align: "center", width: 6 },
    { label: "Item Code", width: 14 },
    { label: "Item Name", width: 42 },
    { label: "Qty Sold", align: "right", num: true, total: true, width: 11 },
    { label: "Revenue", align: "right", money: true, total: true, width: 14 },
    { label: "VAT", align: "right", money: true, total: true, width: 12 },
    ...(showProfit
      ? ([
          { label: "Cost", align: "right", money: true, total: true, width: 13 },
          { label: "Profit", align: "right", money: true, total: true, width: 13 },
          { label: "Margin %", align: "right", width: 10 },
        ] as SalesCol[])
      : []),
  ];
  const body: ExcelJS.CellValue[][] = rows.map((p, i) => [
    i + 1,
    p.sku,
    p.name,
    p.qty,
    round2(p.revenue),
    round2(p.vat),
    ...(showProfit ? [round2(p.cost), round2(p.profit), `${p.margin.toFixed(1)}%`] : []),
  ]);
  salesSheet(wb, "By Product", "PRODUCT SALES REPORT", meta, cols, body);
  return wb;
}

// ---------------------------------------------------------------------------
// Stock Count sheet — one row per product with System Qty and a blank (yellow)
// "Counted Qty" column for the accountant to fill, plus a Variance formula.
// Re-importing the filled sheet reads the "Counted Qty" column back in.
// ---------------------------------------------------------------------------
// Excel column letter for a 1-based index (1→A, 27→AA).
function colLetter(idx1: number): string {
  let s = "";
  let n = idx1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function buildStockCountWorkbook(
  count: StockCount,
  products: Product[],
  business: Business,
  showValue = false, // Cost / Sell Price / Total shown only for owner + procurement
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Stock Count", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  // Column-driven so inserting columns can't break the formula references.
  type Kind = "no" | "text" | "num" | "input" | "variance" | "money" | "total" | "by" | "place";
  type SCCol = {
    label: string;
    width: number;
    align?: "right" | "center";
    kind: Kind;
    get?: (p: Product) => ExcelJS.CellValue;
    value?: boolean; // owner/procurement-only money column
  };
  const allCols: SCCol[] = [
    { label: "No", width: 5, align: "center", kind: "no" },
    { label: "Item Code", width: 14, kind: "text", get: (p) => p.sku },
    { label: "Barcode", width: 18, kind: "text", get: (p) => p.barcode || "" },
    { label: "Product Name", width: 40, kind: "text", get: (p) => p.name },
    { label: "Category", width: 18, kind: "text", get: (p) => p.category || "" },
    { label: "Location(s)", width: 22, kind: "text", get: (p) => formatLocations(p) },
    { label: "Unit", width: 7, align: "center", kind: "text", get: (p) => p.unit || "" },
    { label: "System Qty", width: 11, align: "right", kind: "num", get: (p) => p.stock },
    { label: "Counted Qty", width: 12, align: "right", kind: "input" },
    { label: "Counted In", width: 22, kind: "place" },
    { label: "Variance", width: 10, align: "right", kind: "variance" },
    { label: "Cost", width: 11, align: "right", kind: "money", value: true, get: (p) => round2(p.cost) },
    { label: "Sell Price", width: 12, align: "right", kind: "money", value: true, get: (p) => round2(p.price) },
    { label: "Total (Cost)", width: 14, align: "right", kind: "total", value: true },
    { label: "Counted By", width: 16, kind: "by" },
  ];
  const cols = allCols.filter((c) => !c.value || showValue);

  ws.columns = cols.map((c) => ({ width: c.width }));

  const idxOf = (kind: Kind) => cols.findIndex((c) => c.kind === kind) + 1; // 1-based
  const systemCol = colLetter(idxOf("num"));
  const countedCol = colLetter(idxOf("input"));
  const costCol = idxOf("money") > 0 ? colLetter(idxOf("money")) : ""; // first money = Cost

  let row = reportHeader(ws, "STOCK COUNT SHEET", [
    `${business.name} · ${business.branch}`,
    `${count.countNo} · started by ${count.countedBy || "—"}`,
    "Write the physical quantity in the yellow \"Counted Qty\" column, then re-import this file.",
  ], cols.length);

  tableHead(ws, row, cols.map((c) => ({ label: c.label, align: c.align })));

  const countedMap = new Map(count.items.map((i) => [i.productId, i.countedQty]));
  const counterMap = new Map(count.items.map((i) => [i.productId, i.countedBy || ""]));
  const placeMap = new Map(
    count.items.map((i) => [
      i.productId,
      i.placeQty ? (["Store", "Stock", "Vault"] as const).filter((pl) => i.placeQty![pl]).map((pl) => `${pl} ${i.placeQty![pl]}`).join(" · ") : "",
    ]),
  );
  const firstDataRow = row + 1;

  products.forEach((p, i) => {
    const rowNum = firstDataRow + i;
    const r = ws.getRow(rowNum);
    const cq = countedMap.get(p.id);
    cols.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
      cell.border = allThin;
      switch (c.kind) {
        case "no":
          cell.value = i + 1;
          break;
        case "input":
          cell.value = cq != null ? cq : null;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } }; // yellow input
          break;
        case "variance":
          cell.value = { formula: `${countedCol}${rowNum}-${systemCol}${rowNum}` };
          break;
        case "money":
          cell.value = c.get ? c.get(p) : "";
          cell.numFmt = MONEY;
          break;
        case "total":
          cell.value = { formula: `${countedCol}${rowNum}*${costCol}${rowNum}` };
          cell.numFmt = MONEY;
          break;
        case "by":
          cell.value = counterMap.get(p.id) || "";
          break;
        case "place":
          cell.value = placeMap.get(p.id) || "";
          break;
        default:
          cell.value = c.get ? c.get(p) : "";
      }
    });
  });

  // Grand total of the counted stock value (sum of the Total column).
  if (showValue && products.length) {
    const totalIdx = idxOf("total");
    const totalCol = colLetter(totalIdx);
    const lastDataRow = firstDataRow + products.length - 1;
    const totRow = ws.getRow(lastDataRow + 1);
    const lbl = totRow.getCell(totalIdx - 1);
    lbl.value = "TOTAL VALUE";
    lbl.font = { name: CALIBRI, size: 11, bold: true };
    lbl.alignment = { horizontal: "right" };
    lbl.border = allThin;
    const sum = totRow.getCell(totalIdx);
    sum.value = { formula: `SUM(${totalCol}${firstDataRow}:${totalCol}${lastDataRow})` };
    sum.numFmt = MONEY;
    sum.font = { name: CALIBRI, size: 11, bold: true };
    sum.alignment = { horizontal: "right" };
    sum.border = allThin;
  }

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}

// ---------------------------------------------------------------------------
// Combined stock-count report — sums every count's counted quantities per
// product into one consolidated report (you count in batches and post each,
// so this rolls them all up). Cost/Sell/Total value shown only for owner +
// procurement. `rows` are pre-aggregated by the route.
// ---------------------------------------------------------------------------
export type CombinedCountRow = {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  location: string; // gondola/shelf registered on Price labels, e.g. "A12/3"
  unit: string;
  store: number; // counted in Store
  stock: number; // counted in Stock
  vault: number; // counted in Vault
  counted: number; // total across all places
  cost: number;
  price: number;
  total: number; // counted * cost
  date: string; // last count date (dd-mm-yyyy)
  time: string; // last count time (hh:mm)
  reports: number; // in how many counts it appeared
};

export function buildCombinedStockCountWorkbook(
  rows: CombinedCountRow[],
  business: Business,
  countsIncluded: number,
  showValue = false,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Combined Count", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  type Align = "left" | "center" | "right";
  type CCol = {
    label: string;
    get: (r: CombinedCountRow, i: number) => ExcelJS.CellValue;
    align?: Align;
    money?: boolean;
    num?: boolean;
    total?: boolean; // summed into the TOTAL row
    width: number;
  };
  const cols: CCol[] = [
    { label: "No", get: (_r, i) => i + 1, align: "center", width: 5 },
    { label: "Item Code", get: (r) => r.sku, width: 13 },
    { label: "Barcode", get: (r) => r.barcode, width: 16 },
    { label: "Product Name", get: (r) => r.name, width: 38 },
    { label: "Category", get: (r) => r.category, width: 18 },
    { label: "Location", get: (r) => r.location, width: 12 },
    { label: "Unit", get: (r) => r.unit, align: "center", width: 7 },
    { label: "Store", get: (r) => r.store, align: "right", num: true, total: true, width: 8 },
    { label: "Stock", get: (r) => r.stock, align: "right", num: true, total: true, width: 8 },
    { label: "Vault", get: (r) => r.vault, align: "right", num: true, total: true, width: 8 },
    { label: "Total Counted", get: (r) => r.counted, align: "right", num: true, total: true, width: 13 },
    ...(showValue
      ? ([
          { label: "Cost", get: (r) => round2(r.cost), align: "right", money: true, width: 10 },
          { label: "Sell Price", get: (r) => round2(r.price), align: "right", money: true, width: 11 },
          { label: "Total Value", get: (r) => round2(r.total), align: "right", money: true, total: true, width: 13 },
        ] as CCol[])
      : []),
    { label: "Last Count", get: (r) => r.date, align: "center", width: 12 },
    { label: "Time", get: (r) => r.time, align: "center", width: 8 },
    { label: "In Reports", get: (r) => r.reports, align: "right", num: true, width: 10 },
  ];

  ws.columns = cols.map((c) => ({ width: c.width }));

  let row = reportHeader(ws, "COMBINED STOCK COUNT REPORT", [
    `${business.name} · ${business.branch}`,
    `Sum of ${countsIncluded} stock count${countsIncluded === 1 ? "" : "s"} · ${rows.length} products counted`,
  ], cols.length);

  tableHead(
    ws,
    row,
    cols.map((c) => ({ label: c.label, align: c.align === "left" ? undefined : c.align })),
  );

  const firstDataRow = row + 1;
  const totals = cols.map(() => 0);
  rows.forEach((r, i) => {
    const xr = ws.getRow(firstDataRow + i);
    cols.forEach((c, ci) => {
      const cell = xr.getCell(ci + 1);
      const val = c.get(r, i);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
      cell.border = allThin;
      if (c.money) cell.numFmt = MONEY;
      else if (c.num) cell.numFmt = "#,##0";
      if (c.total && typeof val === "number") totals[ci] += val;
    });
  });

  // TOTAL row — label sits in the cell just before the first summed column.
  if (rows.length) {
    const firstTotalIdx = cols.findIndex((c) => c.total);
    const totRow = ws.getRow(firstDataRow + rows.length);
    cols.forEach((c, ci) => {
      const cell = totRow.getCell(ci + 1);
      if (ci === firstTotalIdx - 1) cell.value = "TOTAL";
      else if (c.total) {
        cell.value = c.money ? round2(totals[ci]) : totals[ci];
        cell.numFmt = c.money ? MONEY : "#,##0";
      }
      cell.font = { name: CALIBRI, size: 11, bold: true, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
      cell.border = allThin;
    });
  }

  ws.views = [{ state: "frozen", ySplit: firstDataRow - 1 }];
  return wb;
}
