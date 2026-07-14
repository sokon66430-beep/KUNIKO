import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";
import { buildCombinedStockCountWorkbook, type CombinedCountRow } from "@/lib/excelExport";
import { buildPdf, buildCsv, type Col, type ReportData } from "@/lib/reportExport";
import { COUNT_PLACES } from "@/lib/types";
import { formatLocations } from "@/lib/location";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (x: number) => String(x).padStart(2, "0");
const ddmmyyyy = (iso?: string) => (iso ? `${pad(new Date(iso).getDate())}-${pad(new Date(iso).getMonth() + 1)}-${new Date(iso).getFullYear()}` : "");
const hhmm = (iso?: string) => (iso ? `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}` : "");

// One big report that SUMS the counted quantity of every stock count, per
// product. You count in batches and post each, so this rolls them all up into
// a single consolidated total (and total stock value). ?format=xlsx|pdf|csv
export async function GET(req: Request) {
  const db = await readDB();
  const session = await getSession();
  const showValue = !!session && canSeeProfit(session.role);
  const format = new URL(req.url).searchParams.get("format") || "xlsx";

  // Sum countedQty per product across every stock count, and note how many
  // counts each product appeared in.
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  type Agg = {
    counted: number;
    reports: Set<string>;
    places: Record<(typeof COUNT_PLACES)[number], number>;
    lastAt: string; // most recent time this product was counted
  };
  const agg = new Map<string, Agg>();
  for (const c of db.stockCounts) {
    for (const it of c.items) {
      const e: Agg =
        agg.get(it.productId) ?? { counted: 0, reports: new Set<string>(), places: { Store: 0, Stock: 0, Vault: 0 }, lastAt: "" };
      e.counted += it.countedQty;
      e.reports.add(c.countNo);
      for (const pl of COUNT_PLACES) e.places[pl] += it.placeQty?.[pl] ?? 0;
      const at = it.countedAt || c.createdAt || "";
      if (at > e.lastAt) e.lastAt = at;
      agg.set(it.productId, e);
    }
  }

  const rows: CombinedCountRow[] = [...agg.entries()]
    .map(([productId, e]) => {
      const p = prodById.get(productId);
      const cost = p?.cost ?? 0;
      return {
        sku: p?.sku ?? productId,
        barcode: p?.barcode ?? "",
        name: p?.name ?? "(deleted product)",
        category: p?.category ?? "",
        location: p ? formatLocations(p) : "",
        unit: p?.unit ?? "",
        store: e.places.Store,
        stock: e.places.Stock,
        vault: e.places.Vault,
        counted: e.counted,
        cost,
        price: p?.price ?? 0,
        total: round2(e.counted * cost),
        date: ddmmyyyy(e.lastAt),
        time: hhmm(e.lastAt),
        reports: e.reports.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `Combined-Stock-Count-${stamp}`;

  // Excel: bespoke workbook (only Total Counted + Total Value are summed).
  if (format === "xlsx") {
    const wb = buildCombinedStockCountWorkbook(rows, db.meta.business, db.stockCounts.length, showValue);
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }

  // CSV / PDF: shared column set. Cost/Sell are pre-formatted strings so they
  // aren't summed; only Total Value carries a grand total.
  const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cols: Col[] = [
    { header: "Item Code", get: (r: CombinedCountRow) => r.sku },
    { header: "Barcode", get: (r: CombinedCountRow) => r.barcode },
    { header: "Product Name", get: (r: CombinedCountRow) => r.name, width: 2 },
    { header: "Category", get: (r: CombinedCountRow) => r.category },
    { header: "Location", get: (r: CombinedCountRow) => r.location },
    { header: "Unit", get: (r: CombinedCountRow) => r.unit },
    { header: "Store", get: (r: CombinedCountRow) => r.store, num: true },
    { header: "Stock", get: (r: CombinedCountRow) => r.stock, num: true },
    { header: "Vault", get: (r: CombinedCountRow) => r.vault, num: true },
    { header: "Total Counted", get: (r: CombinedCountRow) => r.counted, num: true },
    ...(showValue
      ? [
          { header: "Cost", get: (r: CombinedCountRow) => money(r.cost) },
          { header: "Sell Price", get: (r: CombinedCountRow) => money(r.price) },
          { header: "Total Value", get: (r: CombinedCountRow) => r.total, money: true },
        ]
      : []),
    { header: "Last Count", get: (r: CombinedCountRow) => r.date },
    { header: "Time", get: (r: CombinedCountRow) => r.time },
    { header: "In Reports", get: (r: CombinedCountRow) => r.reports, num: true },
  ];
  const data: ReportData = {
    title: "Combined Stock Count Report",
    filename,
    subtitle: `${db.meta.business.name} · ${db.meta.business.branch}   ·   Sum of ${db.stockCounts.length} count${db.stockCounts.length === 1 ? "" : "s"}`,
    cols,
    rows,
  };

  if (format === "csv") {
    return new NextResponse(buildCsv(cols, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }
  const bytes = await buildPdf(data);
  return new NextResponse(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}
