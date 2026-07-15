import { readDB } from "@/lib/db";
import { respondReport, type ReportData } from "@/lib/reportExport";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";

export const dynamic = "force-dynamic";

// Items sold in a date range, grouped/sorted by category — xlsx | csv | pdf.
// ?from & ?to are yyyy-mm-dd (inclusive). Used by the POS Sales Report export.
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const format = url.searchParams.get("format") || "xlsx";
  const catOf = new Map(db.products.map((p) => [p.id, p.category] as const));
  const barcodeOf = new Map(db.products.map((p) => [p.id, p.barcode || ""] as const));

  const inRange = (iso: string) => {
    const d = (iso || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const items = new Map<string, { category: string; sku: string; barcode: string; name: string; qty: number; revenue: number; cost: number }>();
  for (const sale of db.sales) {
    if (!inRange(sale.createdAt)) continue;
    for (const it of sale.items) {
      const category = catOf.get(it.productId) || "Uncategorized";
      const e =
        items.get(it.productId) ??
        items
          .set(it.productId, { category, sku: it.sku, barcode: barcodeOf.get(it.productId) || "", name: it.name, qty: 0, revenue: 0, cost: 0 })
          .get(it.productId)!;
      e.qty += it.qty;
      e.revenue += it.price * it.qty;
      e.cost += it.cost * it.qty;
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Sort by category, then best sellers within each category.
  const rows = [...items.values()]
    .map((x) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.qty - a.qty);

  const session = await getSession();
  // Profit is restricted to Procurement + owner — drop the column for
  // everyone else rather than exporting the real figure to a file.
  const showProfit = !!session && canSeeProfit(session.role);

  const period = from && from === to ? from : `${from || "start"} → ${to || "today"}`;
  // Stamp the report with the date & time it was generated, in Cambodia local
  // time (UTC+7) regardless of where the server runs.
  const nowKh = new Date(Date.now() + 7 * 3600 * 1000);
  const p2 = (x: number) => String(x).padStart(2, "0");
  const generated = `${p2(nowKh.getUTCDate())}-${p2(nowKh.getUTCMonth() + 1)}-${nowKh.getUTCFullYear()} ${p2(nowKh.getUTCHours())}:${p2(nowKh.getUTCMinutes())}`;
  const data: ReportData = {
    title: "Sales by Category",
    filename: "Sales-by-Category",
    subtitle: `${db.meta.business.name} · ${db.meta.business.branch}   ·   Period: ${period}   ·   Generated: ${generated}`,
    rows,
    cols: [
      { header: "Category", get: (r: any) => r.category, width: 1.5 },
      { header: "Item Code", get: (r: any) => r.sku },
      { header: "Barcode", get: (r: any) => r.barcode },
      { header: "Item Name", get: (r: any) => r.name, width: 2 },
      { header: "Qty Sold", get: (r: any) => r.qty, num: true },
      { header: "Revenue", get: (r: any) => r.revenue, money: true },
      ...(showProfit ? [{ header: "Profit", get: (r: any) => r.profit, money: true }] : []),
    ],
  };
  return respondReport(data, format);
}
