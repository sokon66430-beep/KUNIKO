import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { profitFor } from "@/lib/caps";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Sales performance for the POS report: units sold, revenue, cost and profit,
// broken down by item and by category. Optional ?from / ?to (yyyy-mm-dd).
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const catOf = new Map(db.products.map((p) => [p.id, p.category] as const));

  const inRange = (iso: string) => {
    const d = (iso || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  type Agg = { qty: number; revenue: number; cost: number };
  // productId is carried in the row, not just as the map key: callers need to
  // get from "this sold the most" back to the product itself (the till's
  // favourites do exactly that), and matching on name or SKU would be guessing.
  const items = new Map<string, Agg & { productId: string; sku: string; name: string; category: string }>();
  const cats = new Map<string, Agg & { category: string }>();
  let totalQty = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  let saleCount = 0;

  for (const sale of db.sales) {
    if (sale.cancelled) continue; // voided invoices don't count
    if (!inRange(sale.createdAt)) continue;
    saleCount++;
    for (const it of sale.items) {
      const category = catOf.get(it.productId) || "Uncategorized";
      const revenue = it.price * it.qty;
      const cost = it.cost * it.qty;
      totalQty += it.qty;
      totalRevenue += revenue;
      totalCost += cost;
      const ie =
        items.get(it.productId) ??
        items
          .set(it.productId, { productId: it.productId, sku: it.sku, name: it.name, category, qty: 0, revenue: 0, cost: 0 })
          .get(it.productId)!;
      ie.qty += it.qty;
      ie.revenue += revenue;
      ie.cost += cost;
      const ce = cats.get(category) ?? cats.set(category, { category, qty: 0, revenue: 0, cost: 0 }).get(category)!;
      ce.qty += it.qty;
      ce.revenue += revenue;
      ce.cost += cost;
    }
  }

  const finish = <T extends Agg>(x: T) => ({
    ...x,
    revenue: round2(x.revenue),
    cost: round2(x.cost),
    profit: round2(x.revenue - x.cost),
  });
  const byItem = [...items.values()].map(finish).sort((a, b) => b.qty - a.qty);
  const byCategory = [...cats.values()].map(finish).sort((a, b) => b.revenue - a.revenue);

  const session = await getSession();
  // Cost + profit are restricted to Procurement + owner — showing revenue and
  // cost side by side lets anyone back out the margin, so both are zeroed.
  const hideProfit = !session || !(await profitFor(session.role));
  const strip = <T extends { cost: number; profit: number }>(x: T) => (hideProfit ? { ...x, cost: 0, profit: 0 } : x);

  return NextResponse.json({
    byItem: byItem.map(strip),
    byCategory: byCategory.map(strip),
    totals: {
      qty: totalQty,
      revenue: round2(totalRevenue),
      cost: hideProfit ? 0 : round2(totalCost),
      profit: hideProfit ? 0 : round2(totalRevenue - totalCost),
      sales: saleCount,
    },
  });
}
