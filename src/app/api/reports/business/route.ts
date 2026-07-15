import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Business reports feed: best sellers, top products, category performance,
// slow-moving stock, and a today-vs-yesterday comparison — all for one date
// range. The client slices best-seller / top-product / slow-mover lists to the
// N it wants to show, so changing N never needs a refetch.
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const day = url.searchParams.get("day") || to; // "today" for the comparison
  const prevDay = url.searchParams.get("prevDay") || ""; // "yesterday"

  const catOf = new Map(db.products.map((p) => [p.id, p.category] as const));
  const inRange = (iso: string) => {
    const d = (iso || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  // ---- Per-product + per-category aggregation over the range ----
  type Agg = { sku: string; name: string; category: string; qty: number; revenue: number; cost: number };
  const byProduct = new Map<string, Agg>();
  const byCategory = new Map<string, { category: string; qty: number; revenue: number; cost: number }>();
  let totalQty = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  let txCount = 0;

  for (const sale of db.sales) {
    if (!inRange(sale.createdAt)) continue;
    txCount++;
    for (const it of sale.items) {
      const category = catOf.get(it.productId) || "Uncategorized";
      const revenue = it.price * it.qty;
      const cost = it.cost * it.qty;
      totalQty += it.qty;
      totalRevenue += revenue;
      totalCost += cost;
      const p =
        byProduct.get(it.productId) ??
        byProduct.set(it.productId, { sku: it.sku, name: it.name, category, qty: 0, revenue: 0, cost: 0 }).get(it.productId)!;
      p.qty += it.qty;
      p.revenue += revenue;
      p.cost += cost;
      const c =
        byCategory.get(category) ?? byCategory.set(category, { category, qty: 0, revenue: 0, cost: 0 }).get(category)!;
      c.qty += it.qty;
      c.revenue += revenue;
      c.cost += cost;
    }
  }

  const finishProduct = (x: Agg) => ({
    sku: x.sku,
    name: x.name,
    category: x.category,
    qty: x.qty,
    revenue: round2(x.revenue),
    cost: round2(x.cost),
    profit: round2(x.revenue - x.cost),
  });

  const products = [...byProduct.values()].map(finishProduct);
  const bestSellers = [...products].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 500);
  const topProducts = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 500);

  const categories = [...byCategory.values()]
    .map((c) => ({
      category: c.category,
      qty: c.qty,
      revenue: round2(c.revenue),
      cost: round2(c.cost),
      profit: round2(c.revenue - c.cost),
      share: totalRevenue > 0 ? round2((c.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ---- Slow-moving stock: on-hand items that barely (or never) sold in range,
  // slowest first. Only stock-tracked items with units on hand. ----
  const soldQty = new Map<string, number>();
  for (const [pid, a] of byProduct) soldQty.set(pid, a.qty);
  const days = Math.max(1, rangeDays(from, to));
  const slowMoving = db.products
    .filter((p) => p.trackStock !== false && p.stock > 0)
    .map((p) => {
      const qty = soldQty.get(p.id) || 0;
      const perDay = qty / days;
      return {
        sku: p.sku,
        name: p.name,
        category: p.category,
        stock: p.stock,
        qty,
        revenue: round2(qty * p.price),
        // How many days the current stock would last at the recent sales pace.
        // Infinity (no sales) is capped/flagged as null so the UI can show "—".
        daysCover: perDay > 0 ? Math.round(p.stock / perDay) : null,
      };
    })
    .sort((a, b) => a.qty - b.qty || b.stock - a.stock)
    .slice(0, 500);

  // ---- Today vs yesterday ----
  const daySummary = (d: string) => {
    let qty = 0;
    let revenue = 0;
    let cost = 0;
    let tx = 0;
    if (d) {
      for (const sale of db.sales) {
        if (sale.createdAt.slice(0, 10) !== d) continue;
        tx++;
        for (const it of sale.items) {
          qty += it.qty;
          revenue += it.price * it.qty;
          cost += it.cost * it.qty;
        }
      }
    }
    return { date: d, qty, revenue: round2(revenue), cost: round2(cost), profit: round2(revenue - cost), tx };
  };

  const session = await getSession();
  const showProfit = !session || canSeeProfit(session.role);
  const stripProfit = <T extends { cost?: number; profit?: number }>(x: T): T =>
    showProfit ? x : { ...x, cost: 0, profit: 0 };

  const payload = {
    period: { from, to },
    totals: {
      qty: totalQty,
      revenue: round2(totalRevenue),
      cost: showProfit ? round2(totalCost) : 0,
      profit: showProfit ? round2(totalRevenue - totalCost) : 0,
      tx: txCount,
    },
    bestSellers: bestSellers.map(stripProfit),
    topProducts: topProducts.map(stripProfit),
    categories: categories.map(stripProfit),
    slowMoving, // no profit field to strip
    today: stripProfit(daySummary(day)),
    yesterday: stripProfit(daySummary(prevDay)),
    showProfit,
  };
  return NextResponse.json(payload);
}

function rangeDays(from: string, to: string): number {
  if (!from || !to) return 1;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}
