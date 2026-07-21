import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildGRNReportWorkbook } from "@/lib/excelExport";
import { respondReport, type ReportData } from "@/lib/reportExport";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

function ddmmyyyy(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// One goods receipt as a downloadable document — ?format=xlsx | pdf | csv.
// Itemized with item code, barcode, name, unit cost, qty received and line cost,
// plus a total cost — the same detail as the full receiving report.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const grn = db.goodsReceipts.find((g) => g.id === params.id);
  if (!grn) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const vatRate = db.meta.business.vatRate ?? 0.1;
  const rows = grn.items.map((it) => {
    const p = prodById.get(it.productId);
    // The cost AS RECEIVED. Falling back to the product's current cost only for
    // receipts raised before the snapshot existed — otherwise a document from
    // last month would re-price itself the day someone changes a cost.
    const cost = round2(it.cost ?? p?.cost ?? 0);
    // Round the unit cost FIRST, then multiply. The printed cost was already
    // 2dp while the line total came off the raw figure, so $0.51 × 5 printed as
    // $2.53 and the page couldn't be checked by hand.
    return {
      sku: it.sku,
      barcode: p?.barcode || "",
      name: it.name,
      cost, // unit cost, EX-VAT
      vat: round2(cost * vatRate), // input VAT on the cost (e.g. 10%)
      sell: round2(p?.price ?? 0), // current shelf/selling price
      qty: it.qtyReceived,
      lineCost: round2(cost * it.qtyReceived),
    };
  });

  const format = new URL(req.url).searchParams.get("format") || "xlsx";
  const note = `Receipt ${grn.grnNo} · ${grn.supplier} · ${ddmmyyyy(grn.createdAt)} · Received by ${grn.receivedBy}`;

  // Money summary for the foot of the document — total cost (ex-VAT), the total
  // VAT (per-unit VAT × qty, summed) and the grand total including VAT, so the
  // PDF carries the same bottom line as the styled Excel.
  const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grandCost = round2(rows.reduce((s, r) => s + r.lineCost, 0));
  const grandVat = round2(rows.reduce((s, r) => s + round2(r.vat * r.qty), 0));

  const data: ReportData = {
    title: `Goods Receipt ${grn.grnNo}`,
    filename: grn.grnNo,
    subtitle: `${db.meta.business.name} · ${db.meta.business.branch}   ·   ${note}`,
    rows,
    summary: [
      { label: "Total cost (ex-VAT)", value: usd(grandCost) },
      { label: `Total VAT ${Math.round(vatRate * 100)}%`, value: usd(grandVat) },
      { label: "Grand total (incl. VAT)", value: usd(round2(grandCost + grandVat)), strong: true },
    ],
    fancyXlsx: async () => buildGRNReportWorkbook([grn], db.products, db.meta.business, note),
    cols: [
      { header: "Item Code", get: (r: any) => r.sku },
      { header: "Barcode", get: (r: any) => r.barcode },
      { header: "Item Name", get: (r: any) => r.name, width: 2 },
      { header: "Cost", get: (r: any) => r.cost, money: true },
      { header: `VAT ${Math.round(vatRate * 100)}%`, get: (r: any) => r.vat, money: true },
      { header: "Sell Price", get: (r: any) => r.sell, money: true },
      { header: "Qty", get: (r: any) => r.qty, num: true },
      { header: "Line Cost", get: (r: any) => r.lineCost, money: true },
    ],
  };
  return respondReport(data, format);
}
