import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import type { DB } from "./types";
import {
  buildPOReportWorkbook,
  buildPRReportWorkbook,
  buildGRNReportWorkbook,
} from "./excelExport";
import { parseQuery, filterPOs, filterPRs, filterGRNs, filterNote, type ReportQuery } from "./reportFilter";

// A single column definition drives all three output formats (CSV, Excel, PDF).
export type Col = {
  header: string;
  get: (row: any) => string | number;
  money?: boolean; // right-aligned + summed in a totals row
  num?: boolean; // right-aligned numeric (not summed)
  width?: number; // relative weight for PDF column sizing
};

export type ReportData = {
  title: string;
  filename: string; // base name without extension
  subtitle: string;
  cols: Col[];
  rows: any[];
  fancyXlsx?: () => Promise<ExcelJS.Workbook>; // ON Mart-styled workbook (xlsx only)
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
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
const money = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number) => Number(n || 0).toLocaleString("en-US");

function cellText(col: Col, row: any): string {
  const v = col.get(row);
  if (col.money) return money(Number(v));
  if (col.num) return plain(Number(v));
  return String(v ?? "");
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function buildCsv(cols: Col[], rows: any[]): string {
  const head = cols.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(cellText(c, r))).join(",")).join("\n");
  return "﻿" + head + "\n" + body; // BOM so Excel opens UTF-8 cleanly
}

// ---------------------------------------------------------------------------
// Excel (generic styled table — used for reports without a bespoke workbook)
// ---------------------------------------------------------------------------
export async function buildGenericXlsx(r: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 4 }] });
  const n = r.cols.length;
  const lastCol = String.fromCharCode(64 + n); // A..Z (reports stay well under 26 cols)

  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = r.title;
  title.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF0B1120" } };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${lastCol}2`);
  const sub = ws.getCell("A2");
  sub.value = r.subtitle;
  sub.font = { name: "Calibri", size: 9.5, color: { argb: "FF64748B" } };

  // Header row (row 4)
  const header = ws.getRow(4);
  r.cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2549E8" } };
    cell.alignment = { vertical: "middle", horizontal: c.money || c.num ? "right" : "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });
  header.height = 18;

  // Data rows
  r.rows.forEach((row, idx) => {
    const xlRow = ws.getRow(5 + idx);
    r.cols.forEach((c, i) => {
      const cell = xlRow.getCell(i + 1);
      const raw = c.get(row);
      cell.value = c.money || c.num ? Number(raw) : String(raw ?? "");
      if (c.money) cell.numFmt = '"$"#,##0.00';
      else if (c.num) cell.numFmt = "#,##0";
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
      cell.alignment = { horizontal: c.money || c.num ? "right" : "left" };
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
    });
  });

  // Totals row for money columns
  const hasMoney = r.cols.some((c) => c.money);
  if (hasMoney && r.rows.length) {
    const totRow = ws.getRow(5 + r.rows.length);
    r.cols.forEach((c, i) => {
      const cell = totRow.getCell(i + 1);
      if (i === 0) cell.value = "TOTAL";
      else if (c.money) {
        cell.value = r.rows.reduce((s, row) => s + Number(c.get(row) || 0), 0);
        cell.numFmt = '"$"#,##0.00';
      }
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0B1120" } };
      cell.alignment = { horizontal: c.money || c.num ? "right" : "left" };
      cell.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
    });
  }

  // Column widths
  r.cols.forEach((c, i) => {
    const headerLen = c.header.length;
    const sample = Math.max(...r.rows.slice(0, 40).map((row) => cellText(c, row).length), headerLen);
    ws.getColumn(i + 1).width = Math.min(46, Math.max(9, sample + 2));
  });

  const buf = await wb.xlsx.writeBuffer();
  return buf as Buffer;
}

// ---------------------------------------------------------------------------
// PDF (pdf-lib — A4 landscape table with header, striping, pagination, totals)
// ---------------------------------------------------------------------------
// Standard PDF fonts are WinAnsi; strip anything they can't encode so the
// document never fails to render on an unexpected character.
function ascii(s: string): string {
  return String(s ?? "").replace(/[^\x20-\x7E]/g, "?");
}

export async function buildPdf(r: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 842;
  const PAGE_H = 595;
  const M = 36;
  const contentW = PAGE_W - M * 2;

  const ink = rgb(0.043, 0.067, 0.125);
  const slate = rgb(0.39, 0.45, 0.55);
  const brand = rgb(0.145, 0.286, 0.91);
  const stripe = rgb(0.965, 0.973, 0.984);
  const line = rgb(0.8, 0.84, 0.89);

  // Column widths: natural size (header + sampled cells) scaled to fit page.
  const HSIZE = 8.5;
  const RSIZE = 8.5;
  const pad = 4;
  const natural = r.cols.map((c) => {
    let w = bold.widthOfTextAtSize(ascii(c.header), HSIZE);
    for (const row of r.rows.slice(0, 60)) {
      w = Math.max(w, font.widthOfTextAtSize(ascii(cellText(c, row)), RSIZE));
    }
    return Math.min(w + pad * 2, 200) * (c.width || 1);
  });
  const totalNat = natural.reduce((s, w) => s + w, 0);
  const scale = totalNat > contentW ? contentW / totalNat : 1;
  const widths = natural.map((w) => w * scale);

  const rowH = 16;
  const money = r.cols.some((c) => c.money);

  let page: any = null;
  let y = 0;

  const truncate = (text: string, w: number, f: any, size: number) => {
    let s = ascii(text);
    const max = w - pad * 2;
    if (f.widthOfTextAtSize(s, size) <= max) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + ".", size) > max) s = s.slice(0, -1);
    return s + ".";
  };

  const drawHeaderRow = () => {
    page.drawRectangle({ x: M, y: y - rowH + 3, width: contentW, height: rowH, color: brand });
    let x = M;
    r.cols.forEach((c, i) => {
      const w = widths[i];
      const t = truncate(c.header, w, bold, HSIZE);
      const tw = bold.widthOfTextAtSize(t, HSIZE);
      const tx = c.money || c.num ? x + w - pad - tw : x + pad;
      page.drawText(t, { x: tx, y: y - rowH + 8, size: HSIZE, font: bold, color: rgb(1, 1, 1) });
      x += w;
    });
    y -= rowH;
  };

  const newPage = (first: boolean) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
    if (first) {
      page.drawText(ascii(r.title), { x: M, y: y - 4, size: 16, font: bold, color: ink });
      y -= 20;
      page.drawText(ascii(r.subtitle), { x: M, y: y - 2, size: 9, font, color: slate });
      y -= 18;
    }
    drawHeaderRow();
  };

  newPage(true);

  r.rows.forEach((row, idx) => {
    if (y - rowH < M + (money ? rowH : 0)) newPage(false);
    if (idx % 2 === 1) {
      page.drawRectangle({ x: M, y: y - rowH + 3, width: contentW, height: rowH, color: stripe });
    }
    let x = M;
    r.cols.forEach((c, i) => {
      const w = widths[i];
      const t = truncate(cellText(c, row), w, font, RSIZE);
      const tw = font.widthOfTextAtSize(t, RSIZE);
      const tx = c.money || c.num ? x + w - pad - tw : x + pad;
      page.drawText(t, { x: tx, y: y - rowH + 8, size: RSIZE, font, color: ink });
      x += w;
    });
    y -= rowH;
  });

  // Totals row
  if (money && r.rows.length) {
    if (y - rowH < M) newPage(false);
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + contentW, y: y + 2 }, thickness: 0.7, color: line });
    let x = M;
    r.cols.forEach((c, i) => {
      const w = widths[i];
      let t = "";
      if (i === 0) t = "TOTAL";
      else if (c.money) t = "$" + r.rows.reduce((s, row) => s + Number(c.get(row) || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (t) {
        const tw = bold.widthOfTextAtSize(t, RSIZE);
        const tx = c.money || c.num ? x + w - pad - tw : x + pad;
        page.drawText(t, { x: tx, y: y - rowH + 8, size: RSIZE, font: bold, color: ink });
      }
      x += w;
    });
    y -= rowH;
  }

  // Footer note on the last page
  page.drawText(ascii(`Generated by Stookii  ·  ${r.rows.length} rows`).replace(/·/g, "|"), {
    x: M,
    y: M - 14,
    size: 7.5,
    font,
    color: slate,
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Report definitions — columns + rows for every report type
// ---------------------------------------------------------------------------
function inRange(iso: string, q: ReportQuery): boolean {
  const day = (iso || "").slice(0, 10);
  if (q.from && day < q.from) return false;
  if (q.to && day > q.to) return false;
  return true;
}
const sum = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + f(x), 0);

export type ReportKey =
  | "sales"
  | "purchase-orders"
  | "purchase-requests"
  | "goods-receipts"
  | "stock-counts";

export function getReportData(key: ReportKey, db: DB, q: ReportQuery): ReportData {
  const biz = db.meta.business?.name || "Stookii";
  const note = filterNote(q);
  const subtitle = `${biz}   |   ${note}`;

  switch (key) {
    case "sales": {
      const rows = db.sales
        .filter((s) => inRange(s.createdAt, q))
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return {
        title: "Sales & Profit Report",
        filename: "Sales-Report",
        subtitle,
        rows,
        cols: [
          { header: "Date", get: (s) => ddmmyyyy(s.createdAt) },
          { header: "Time", get: (s) => hhmm(s.createdAt) },
          { header: "Invoice", get: (s) => s.invoiceNo },
          { header: "Customer", get: (s) => s.customerName || "Walk-in", width: 1.3 },
          { header: "Items", get: (s) => s.items.length, num: true },
          { header: "Subtotal", get: (s) => s.subtotal, money: true },
          { header: "Discount", get: (s) => s.discount, money: true },
          { header: "Tax", get: (s) => s.tax, money: true },
          { header: "Total", get: (s) => s.total, money: true },
          { header: "Cost", get: (s) => s.cost, money: true },
          { header: "Profit", get: (s) => s.profit, money: true },
          { header: "Payment", get: (s) => s.paymentMethod },
        ],
      };
    }
    case "purchase-orders": {
      const rows = filterPOs(db.purchaseOrders, q);
      return {
        title: "Purchase Order Report",
        filename: "Purchase-Order-Report",
        subtitle,
        rows,
        fancyXlsx: async () => buildPOReportWorkbook(rows, db.meta.business, note),
        cols: [
          { header: "Date", get: (p) => ddmmyyyy(p.createdAt) },
          { header: "PO No", get: (p) => p.poNo },
          { header: "Supplier", get: (p) => p.supplier, width: 1.6 },
          { header: "Status", get: (p) => p.status },
          { header: "Items", get: (p) => p.items.length, num: true },
          { header: "Qty Ordered", get: (p) => sum(p.items, (i: any) => i.qtyOrdered), num: true },
          { header: "Qty Received", get: (p) => sum(p.items, (i: any) => i.qtyReceived), num: true },
          { header: "Value (ex-VAT)", get: (p) => sum(p.items, (i: any) => i.cost * i.qtyOrdered), money: true },
        ],
      };
    }
    case "purchase-requests": {
      const rows = filterPRs(db.purchaseRequests, q);
      return {
        title: "Purchase Request Report",
        filename: "Purchase-Request-Report",
        subtitle,
        rows,
        fancyXlsx: async () => buildPRReportWorkbook(rows, db.meta.business, note),
        cols: [
          { header: "Date", get: (p) => ddmmyyyy(p.createdAt) },
          { header: "PR No", get: (p) => p.prNo },
          { header: "Status", get: (p) => p.status },
          { header: "Requested By", get: (p) => p.requestedBy, width: 1.3 },
          { header: "Items", get: (p) => p.items.length, num: true },
          { header: "Qty", get: (p) => sum(p.items, (i: any) => i.qty), num: true },
          { header: "Est. Value", get: (p) => sum(p.items, (i: any) => i.cost * i.qty), money: true },
        ],
      };
    }
    case "goods-receipts": {
      const grns = filterGRNs(db.goodsReceipts, q);
      const prodById = new Map(db.products.map((p) => [p.id, p]));
      // One row per received item, enriched with barcode + cost from the master,
      // so the report shows item detail and the total cost of goods received.
      const rows = grns.flatMap((g) =>
        g.items.map((it) => {
          const p = prodById.get(it.productId);
          const cost = p?.cost ?? 0;
          return {
            date: ddmmyyyy(g.createdAt),
            grnNo: g.grnNo,
            poNo: g.poNo,
            supplier: g.supplier,
            sku: it.sku,
            barcode: p?.barcode || "",
            name: it.name,
            cost,
            qty: it.qtyReceived,
            lineCost: cost * it.qtyReceived,
            receivedBy: g.receivedBy,
          };
        }),
      );
      return {
        title: "Goods Receiving Report",
        filename: "Receiving-Report",
        subtitle,
        rows,
        fancyXlsx: async () => buildGRNReportWorkbook(grns, db.products, db.meta.business, note),
        cols: [
          { header: "Date", get: (r) => r.date },
          { header: "GRN No", get: (r) => r.grnNo },
          { header: "PO No", get: (r) => r.poNo },
          { header: "Supplier", get: (r) => r.supplier, width: 1.6 },
          { header: "Item Code", get: (r) => r.sku },
          { header: "Barcode", get: (r) => r.barcode },
          { header: "Item Name", get: (r) => r.name, width: 2 },
          { header: "Cost", get: (r) => r.cost, money: true },
          { header: "Qty", get: (r) => r.qty, num: true },
          { header: "Line Cost", get: (r) => r.lineCost, money: true },
          { header: "Received By", get: (r) => r.receivedBy, width: 1.2 },
        ],
      };
    }
    case "stock-counts": {
      const rows = db.stockCounts
        .filter((c) => inRange(c.createdAt, q))
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return {
        title: "Stock Count Report",
        filename: "Stock-Count-Report",
        subtitle,
        rows,
        cols: [
          { header: "Date", get: (c) => ddmmyyyy(c.createdAt) },
          { header: "Count No", get: (c) => c.countNo },
          { header: "Status", get: (c) => c.status },
          { header: "Counted By", get: (c) => c.countedBy, width: 1.3 },
          { header: "Items", get: (c) => c.items.length, num: true },
          { header: "Counted Qty", get: (c) => sum(c.items, (i: any) => i.countedQty), num: true },
          {
            header: "Variance",
            get: (c) => sum(c.items, (i: any) => i.countedQty - i.systemQty),
            num: true,
          },
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Response dispatch — one entry point every report route calls
// ---------------------------------------------------------------------------
export async function respondReport(r: ReportData, format: string): Promise<NextResponse> {
  const name = `${r.filename}-${new Date().toISOString().slice(0, 10)}`; // append YYYY-MM-DD
  if (format === "csv") {
    return new NextResponse(buildCsv(r.cols, r.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }
  if (format === "pdf") {
    const bytes = await buildPdf(r);
    return new NextResponse(bytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
      },
    });
  }
  // default: xlsx
  const buffer = r.fancyXlsx ? await (await r.fancyXlsx()).xlsx.writeBuffer() : await buildGenericXlsx(r);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
    },
  });
}

// Convenience for routes: read db, parse query, build, respond.
export async function sendReport(req: Request, key: ReportKey): Promise<NextResponse> {
  const { readDB } = await import("./db");
  const db = await readDB();
  const q = parseQuery(req.url);
  const format = new URL(req.url).searchParams.get("format") || "xlsx";
  const data = getReportData(key, db, q);
  return respondReport(data, format);
}
