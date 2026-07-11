import ExcelJS from "exceljs";
import type { PurchaseOrder, PurchaseRequest, GoodsReceipt, StockCount, WriteOff, Product, DB } from "./types";

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
export function buildPOWorkbook(po: PurchaseOrder, business: Business): ExcelJS.Workbook {
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
  const vatRate = business.vatRate ?? 0.1;
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
  const noteLines = [...(business.poNotes || []), ...(business.invoiceTo || [])];
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

  return wb;
}

export function buildGRNReportWorkbook(
  grns: GoodsReceipt[],
  business: Business,
  filterNote: string,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Receiving Report", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 6 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 30 },
    { width: 8 }, { width: 13 }, { width: 20 },
  ];

  let row = reportHeader(ws, "GOODS RECEIVING REPORT", [`${business.name} · ${business.branch}`, filterNote], 8);

  tableHead(ws, row, [
    { label: "No" }, { label: "Receipt" }, { label: "Date" }, { label: "PO Number" }, { label: "Supplier" },
    { label: "Items", align: "center" }, { label: "Units Received", align: "right" }, { label: "Received By" },
  ]);

  const firstDataRow = row + 1;
  let grandUnits = 0;
  grns.forEach((g, i) => {
    const r = ws.getRow(firstDataRow + i);
    const units = g.items.reduce((s, it) => s + it.qtyReceived, 0);
    grandUnits += units;
    const cells: [ExcelJS.CellValue, ("right" | "center" | "left")?][] = [
      [i + 1, "center"], [g.grnNo], [ddmmyyyy(g.createdAt), "center"], [g.poNo], [g.supplier],
      [g.items.length, "center"], [units, "right"], [g.receivedBy],
    ];
    cells.forEach(([val, align], c) => {
      const cell = r.getCell(c + 1);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      cell.border = allThin;
    });
  });

  const totalRow = firstDataRow + grns.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(6);
  lbl.value = "TOTAL";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const val = tr.getCell(7);
  val.value = grandUnits;
  val.font = { name: CALIBRI, size: 11, bold: true };
  val.alignment = { horizontal: "right" };
  val.border = allThin;
  tr.getCell(8).border = allThin;

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
    { width: 12 }, { width: 8 }, { width: 16 }, { width: 13 }, { width: 34 },
    { width: 18 }, { width: 10 }, { width: 8 }, { width: 15 }, { width: 26 }, { width: 16 },
  ];

  let row = reportHeader(ws, "WRITE-OFF REPORT", [`${business.name} · ${business.branch}`, filterNote], WRITE_OFF_COLUMNS.length);
  tableHead(
    ws,
    row,
    WRITE_OFF_COLUMNS.map((c) => ({ label: c.header, align: c.header === "Quantity" ? ("right" as const) : undefined })),
  );

  const firstDataRow = row + 1;
  let totalQty = 0;
  writeoffs.forEach((w, i) => {
    const r = ws.getRow(firstDataRow + i);
    totalQty += w.quantity;
    WRITE_OFF_COLUMNS.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      cell.value = c.get(w) as ExcelJS.CellValue;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: c.header === "Quantity" ? "right" : "left", vertical: "middle" };
      cell.border = allThin;
    });
  });

  const totalRow = firstDataRow + writeoffs.length;
  const tr = ws.getRow(totalRow);
  const lbl = tr.getCell(6);
  lbl.value = "TOTAL QTY";
  lbl.font = { name: CALIBRI, size: 11, bold: true };
  lbl.alignment = { horizontal: "right" };
  lbl.border = allThin;
  const val = tr.getCell(7);
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
    { header: "Item ID", key: "sku", width: 14 },
    { header: "Barcode", key: "barcode", width: 18 },
    { header: "Product Name", key: "name", width: 42 },
    { header: "Name KH", key: "nameKh", width: 30 },
    { header: "Category", key: "category", width: 22 },
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

  products.forEach((p) => {
    const r = ws.addRow({
      sku: p.sku,
      barcode: p.barcode || "",
      name: p.name,
      nameKh: p.nameKh || "",
      category: p.category || "",
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
    if (!p.supplierCode) {
      r.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };
      r.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };
    }
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb;
}

// ---------------------------------------------------------------------------
// Stock Count sheet — one row per product with System Qty and a blank (yellow)
// "Counted Qty" column for the accountant to fill, plus a Variance formula.
// Re-importing the filled sheet reads the "Counted Qty" column back in.
// ---------------------------------------------------------------------------
export function buildStockCountWorkbook(
  count: StockCount,
  products: Product[],
  business: Business,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Stock Count", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 5 }, { width: 14 }, { width: 18 }, { width: 42 }, { width: 20 },
    { width: 8 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 18 },
  ];

  let row = reportHeader(ws, "STOCK COUNT SHEET", [
    `${business.name} · ${business.branch}`,
    `${count.countNo} · started by ${count.countedBy || "—"}`,
    "Write the physical quantity in the yellow \"Counted Qty\" column, then re-import this file.",
  ], 10);

  tableHead(ws, row, [
    { label: "No" }, { label: "Item Code" }, { label: "Barcode" }, { label: "Product Name" },
    { label: "Category" }, { label: "Unit", align: "center" }, { label: "System Qty", align: "right" },
    { label: "Counted Qty", align: "right" }, { label: "Variance", align: "right" }, { label: "Counted By" },
  ]);

  const counted = new Map(count.items.map((i) => [i.productId, i.countedQty]));
  const counter = new Map(count.items.map((i) => [i.productId, i.countedBy || ""]));
  const firstDataRow = row + 1;
  products.forEach((p, i) => {
    const r = ws.getRow(firstDataRow + i);
    const cq = counted.get(p.id);
    const cells: [ExcelJS.CellValue, ("right" | "center" | "left")?][] = [
      [i + 1, "center"], [p.sku], [p.barcode || ""], [p.name], [p.category || ""],
      [p.unit || "", "center"], [p.stock, "right"], [cq != null ? cq : null, "right"],
    ];
    cells.forEach(([val, align], c) => {
      const cell = r.getCell(c + 1);
      cell.value = val;
      cell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
      cell.alignment = { horizontal: align || "left", vertical: "middle" };
      cell.border = allThin;
    });
    // Highlight the input column so the counter knows where to write.
    r.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };
    // Variance = Counted − System (live formula).
    const vCell = r.getCell(9);
    vCell.value = { formula: `H${firstDataRow + i}-G${firstDataRow + i}` };
    vCell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
    vCell.alignment = { horizontal: "right", vertical: "middle" };
    vCell.border = allThin;
    // Who counted this line (blank until counted).
    const byCell = r.getCell(10);
    byCell.value = counter.get(p.id) || "";
    byCell.font = { name: CALIBRI, size: 10, color: { argb: "FF0C1322" } };
    byCell.alignment = { horizontal: "left", vertical: "middle" };
    byCell.border = allThin;
  });

  return wb;
}
