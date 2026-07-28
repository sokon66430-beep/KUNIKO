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
  // Per TILL and per CUSTOMER. Both count whole SALES, not item lines — an
  // average basket built from lines would answer "what does an item cost",
  // which nobody is asking.
  type Basket = { sales: number; qty: number; revenue: number; cost: number };
  const tills = new Map<string, Basket & { terminal: string }>();
  const buyers = new Map<string, Basket & { customerId: string; name: string }>();
  let totalQty = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  let saleCount = 0;

  for (const sale of db.sales) {
    if (sale.cancelled) continue; // voided invoices don't count
    if (!inRange(sale.createdAt)) continue;
    saleCount++;

    // Sales rung up before tills were named, or with no shift attached, still
    // have to appear somewhere — silently dropping them would make the till
    // totals disagree with the headline revenue.
    const till = sale.posTerminalId || "Unassigned";
    const te = tills.get(till) ?? tills.set(till, { terminal: till, sales: 0, qty: 0, revenue: 0, cost: 0 }).get(till)!;
    // A named customer, or the walk-in bucket — most sales are walk-in, and
    // leaving them out would make the average look like the loyalty average.
    const cid = sale.customerId || "";
    const cname = sale.customerName || "Walk-in";
    const be =
      buyers.get(cid) ?? buyers.set(cid, { customerId: cid, name: cname, sales: 0, qty: 0, revenue: 0, cost: 0 }).get(cid)!;
    te.sales++;
    be.sales++;

    for (const it of sale.items) {
      te.qty += it.qty;
      te.revenue += it.price * it.qty;
      te.cost += it.cost * it.qty;
      be.qty += it.qty;
      be.revenue += it.price * it.qty;
      be.cost += it.cost * it.qty;
    }

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

  // Average basket = revenue ÷ number of SALES. Guarded against zero so an
  // empty day reads $0.00 rather than NaN on the screen.
  const avg = <T extends { sales: number; revenue: number }>(x: T) => ({
    ...x,
    avgSale: x.sales > 0 ? round2(x.revenue / x.sales) : 0,
  });
  const byTerminal = [...tills.values()].map(finish).map(avg).sort((a, b) => b.revenue - a.revenue);
  const byCustomer = [...buyers.values()].map(finish).map(avg).sort((a, b) => b.revenue - a.revenue);

  const session = await getSession();
  // Cost + profit are restricted to Procurement + owner — showing revenue and
  // cost side by side lets anyone back out the margin, so both are zeroed.
  const hideProfit = !session || !(await profitFor(session.role));
  const strip = <T extends { cost: number; profit: number }>(x: T) => (hideProfit ? { ...x, cost: 0, profit: 0 } : x);

  return NextResponse.json({
    byItem: byItem.map(strip),
    byCategory: byCategory.map(strip),
    byTerminal: byTerminal.map(strip),
    byCustomer: byCustomer.map(strip),
    totals: {
      qty: totalQty,
      revenue: round2(totalRevenue),
      cost: hideProfit ? 0 : round2(totalCost),
      profit: hideProfit ? 0 : round2(totalRevenue - totalCost),
      sales: saleCount,
      // The headline the owner actually asks for: what an average customer
      // spends per visit.
      avgSale: saleCount > 0 ? round2(totalRevenue / saleCount) : 0,
    },
  });
}
