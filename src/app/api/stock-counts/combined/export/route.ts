import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";
import { buildCombinedStockCountWorkbook, type CombinedCountRow } from "@/lib/excelExport";
import { buildPdf, buildCsv, type Col, type ReportData } from "@/lib/reportExport";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const agg = new Map<string, { counted: number; reports: Set<string> }>();
  for (const c of db.stockCounts) {
    for (const it of c.items) {
      const e = agg.get(it.productId) ?? { counted: 0, reports: new Set<string>() };
      e.counted += it.countedQty;
      e.reports.add(c.countNo);
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
        unit: p?.unit ?? "",
        counted: e.counted,
        cost,
        price: p?.price ?? 0,
        total: round2(e.counted * cost),
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
    { header: "Unit", get: (r: CombinedCountRow) => r.unit },
    { header: "Total Counted", get: (r: CombinedCountRow) => r.counted, num: true },
    ...(showValue
      ? [
          { header: "Cost", get: (r: CombinedCountRow) => money(r.cost) },
          { header: "Sell Price", get: (r: CombinedCountRow) => money(r.price) },
          { header: "Total Value", get: (r: CombinedCountRow) => r.total, money: true },
        ]
      : []),
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
