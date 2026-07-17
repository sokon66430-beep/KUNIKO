import type { DB, Sale } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** yyyy-mm-dd on the LOCAL calendar — never toISOString(), which is UTC. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function inRange(s: Sale, from: Date, to: Date) {
  const t = +new Date(s.createdAt);
  return t >= +from && t < +to;
}

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d";

export function rangeBounds(range: RangeKey): { from: Date; to: Date; days: number } {
  const to = new Date();
  const from = startOfDay(new Date());
  if (range === "today") return { from, to, days: 1 };

  // Yesterday is the only range that ENDS in the past — every other one runs up
  // to this moment. It stops at midnight today, which `inRange` excludes since
  // it tests `t < to`, so a sale rung up this morning can't leak into it. A
  // closed day is the one figure that shouldn't move while you look at it.
  if (range === "yesterday") {
    const f = startOfDay(new Date());
    f.setDate(f.getDate() - 1);
    return { from: f, to: startOfDay(new Date()), days: 1 };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const f = startOfDay(new Date());
  f.setDate(f.getDate() - (days - 1));
  return { from: f, to, days };
}

function sum(sales: Sale[], pick: (s: Sale) => number) {
  return round2(sales.reduce((acc, s) => acc + pick(s), 0));
}

export function buildStats(db: DB, range: RangeKey = "30d") {
  const { from, to, days } = rangeBounds(range);
  const sales = db.sales.filter((s) => inRange(s, from, to));

  const revenue = sum(sales, (s) => s.total);
  const netSales = sum(sales, (s) => s.subtotal - s.discount);
  const profit = sum(sales, (s) => s.profit);
  const cogs = sum(sales, (s) => s.cost);
  const tax = sum(sales, (s) => s.tax);
  // What was given away, and it has to cover BOTH kinds or the number lies.
  //
  // `sale.discount` is the basket-level cut — a manual discount plus whatever
  // the deals engine worked out. A MARK DOWN never appears there: its label
  // sells at an already-reduced price, so the cut is the gap between the line's
  // `fullPrice` snapshot and what was actually charged. A shop that clears
  // stock with markdown labels would otherwise read $0 discount while giving
  // away real money every day.
  const basketDiscount = sum(sales, (s) => s.discount);
  const markdownDiscount = round2(
    sum(sales, (s) =>
      s.items.reduce((a, it) => a + (it.markdownCode ? it.qty * ((it.fullPrice ?? it.price) - it.price) : 0), 0),
    ),
  );
  const discount = round2(basketDiscount + markdownDiscount);

  // Gross: the full shelf price of everything sold, before anything came off.
  //
  // Derived by adding the discount back rather than re-summing the lines,
  // because that's what keeps the three figures honest as one statement:
  //
  //     grossRevenue − discount = revenue (what customers actually paid)
  //
  // `revenue` above is already net — a sale's `total` is gross-minus-discount,
  // and a markdown line's price is the reduced one. So both kinds of discount
  // have to be added back to get to gross, which is exactly what `discount`
  // now sums.
  const grossRevenue = round2(revenue + discount);
  const txCount = sales.length;
  const itemsSold = sales.reduce(
    (acc, s) => acc + s.items.reduce((a, it) => a + it.qty, 0),
    0
  );
  const avgTicket = txCount ? round2(revenue / txCount) : 0;
  const margin = netSales ? round2((profit / netSales) * 100) : 0;

  // Today (always, regardless of range) for headline cards
  const todayFrom = startOfDay(new Date());
  const todaySales = db.sales.filter((s) => inRange(s, todayFrom, new Date()));
  const todayRevenue = sum(todaySales, (s) => s.total);
  const todayProfit = sum(todaySales, (s) => s.profit);

  // Daily revenue/profit series across the range.
  //
  // Bucketed on the LOCAL calendar date, because that's the day the range was
  // cut on. This used to key buckets with toISOString() — UTC — while building
  // them from local midnight, so anywhere east of Greenwich the bucket for
  // local 16 Jul was labelled 15 Jul, and a sale made that afternoon keyed to
  // 16 Jul and matched no bucket at all. The money vanished off the chart while
  // the cards above it still counted it.
  const seriesMap = new Map<string, { label: string; revenue: number; profit: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    seriesMap.set(dayKey(d), {
      // Built from the Date itself. Re-parsing the key would read it back as
      // UTC midnight and shift the label a day the other way.
      label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      revenue: 0,
      profit: 0,
    });
  }
  for (const s of sales) {
    const cur = seriesMap.get(dayKey(new Date(s.createdAt)));
    if (cur) {
      cur.revenue = round2(cur.revenue + s.total);
      cur.profit = round2(cur.profit + s.profit);
    }
  }
  const series = Array.from(seriesMap.entries()).map(([date, v]) => ({
    date,
    label: v.label,
    revenue: v.revenue,
    profit: v.profit,
  }));

  // Top products by revenue
  const prodMap = new Map<string, { name: string; sku: string; qty: number; revenue: number; profit: number }>();
  for (const s of sales) {
    for (const it of s.items) {
      const cur = prodMap.get(it.productId) || { name: it.name, sku: it.sku, qty: 0, revenue: 0, profit: 0 };
      cur.qty += it.qty;
      cur.revenue = round2(cur.revenue + it.price * it.qty);
      cur.profit = round2(cur.profit + (it.price - it.cost) * it.qty);
      prodMap.set(it.productId, cur);
    }
  }
  const topProducts = Array.from(prodMap.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // Sales by category
  const catMap = new Map<string, number>();
  const productById = new Map(db.products.map((p) => [p.id, p]));
  for (const s of sales) {
    for (const it of s.items) {
      const cat = productById.get(it.productId)?.category || "Other";
      catMap.set(cat, round2((catMap.get(cat) || 0) + it.price * it.qty));
    }
  }
  const byCategory = Array.from(catMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Payment method breakdown
  const payMap = new Map<string, number>();
  for (const s of sales) payMap.set(s.paymentMethod, round2((payMap.get(s.paymentMethod) || 0) + s.total));
  const byPayment = Array.from(payMap.entries()).map(([name, value]) => ({ name, value }));

  // Hour-of-day distribution
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}:00`, revenue: 0 }));
  for (const s of sales) {
    const h = new Date(s.createdAt).getHours();
    hours[h].revenue = round2(hours[h].revenue + s.total);
  }
  const peakHours = hours.filter((h) => h.hour >= 7 && h.hour <= 21);

  // Inventory health
  const lowStock = db.products
    .filter((p) => p.stock <= p.reorderLevel)
    .sort((a, b) => a.stock - b.stock);
  const inventoryValue = round2(db.products.reduce((acc, p) => acc + p.cost * p.stock, 0));
  const retailValue = round2(db.products.reduce((acc, p) => acc + p.price * p.stock, 0));

  return {
    range,
    revenue,
    netSales,
    profit,
    cogs,
    tax,
    discount,
    // The split, so a screen can say WHERE the money went rather than showing
    // one number nobody can act on.
    basketDiscount,
    markdownDiscount,
    // Full shelf price before anything came off. `revenue` stays what it has
    // always been — what customers actually paid — because /reports and the
    // charts already read it that way.
    grossRevenue,
    txCount,
    itemsSold,
    avgTicket,
    margin,
    todayRevenue,
    todayProfit,
    todayTx: todaySales.length,
    series,
    topProducts,
    byCategory,
    byPayment,
    peakHours,
    lowStock,
    lowStockCount: lowStock.length,
    inventoryValue,
    retailValue,
    productCount: db.products.length,
    customerCount: db.customers.length,
  };
}

export type Stats = ReturnType<typeof buildStats>;
