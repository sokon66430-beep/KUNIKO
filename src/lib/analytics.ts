import type { DB, Sale } from "./types";
import { storeToday, storeInstant, shortDay, storeHour } from "./storetime";

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;

// Store-local midnight (a real UTC instant) for the store-day that contains `d`.
// The shop runs on Phnom Penh time while the server runs on UTC, so a plain
// setHours(0,0,0,0) would cut the day at 07:00 local — pushing a 2am sale onto
// the day before and starting "today" at 7am. Cutting on the STORE day fixes it.
const startOfDay = (d: Date): Date => {
  const inst = storeInstant(storeToday(d), "00:00");
  if (inst) return inst;
  const x = new Date(d); // fallback: server-local midnight (shouldn't be reached)
  x.setHours(0, 0, 0, 0);
  return x;
};

/** yyyy-mm-dd on the STORE calendar (Asia/Phnom_Penh), so every bucket is a real shop day. */
const dayKey = (d: Date) => storeToday(d);

function inRange(s: Sale, from: Date, to: Date) {
  const t = +new Date(s.createdAt);
  return t >= +from && t < +to;
}

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d";

// A specific calendar day (yyyy-mm-dd) picked from the dashboard's date picker,
// as a single-day window. Read straight off the string into a LOCAL date so the
// day the user tapped is the day that's summed, on any server timezone.
function customDayBounds(day: string): { from: Date; to: Date; days: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Store-local midnight of the picked day → the next store midnight. So the day
  // the user tapped is the shop's calendar day, on any server timezone.
  const from = storeInstant(day, "00:00");
  if (!from) return null;
  const to = new Date(from.getTime() + DAY_MS);
  return { from, to, days: 1 };
}

export function rangeBounds(
  range: RangeKey,
  customDay?: string,
  customTo?: string,
): { from: Date; to: Date; days: number } {
  if (customDay) {
    const c = customDayBounds(customDay);
    if (c) {
      // A second date turns the single day into an inclusive from–to window.
      const e = customTo ? customDayBounds(customTo) : null;
      if (e && e.from.getTime() >= c.from.getTime()) {
        const days = Math.round((e.from.getTime() - c.from.getTime()) / 86_400_000) + 1;
        return { from: c.from, to: e.to, days };
      }
      return c;
    }
  }
  const to = new Date();
  const todayMidnight = startOfDay(new Date()); // store midnight today
  if (range === "today") return { from: todayMidnight, to, days: 1 };

  // Yesterday is the only range that ENDS in the past — every other one runs up
  // to this moment. It stops at store midnight today, which `inRange` excludes
  // (it tests `t < to`), so a sale rung up this morning can't leak into it. A
  // closed day is the one figure that shouldn't move while you look at it.
  // Cambodia has no DST, so one store day back is exactly 24h earlier.
  if (range === "yesterday") {
    const f = new Date(todayMidnight.getTime() - DAY_MS);
    return { from: f, to: todayMidnight, days: 1 };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const f = new Date(todayMidnight.getTime() - (days - 1) * DAY_MS);
  return { from: f, to, days };
}

function sum(sales: Sale[], pick: (s: Sale) => number) {
  return round2(sales.reduce((acc, s) => acc + pick(s), 0));
}

export function buildStats(db: DB, range: RangeKey = "30d", customDay?: string, customTo?: string) {
  const { from, to, days } = rangeBounds(range, customDay, customTo);
  // Cancelled (voided) invoices are kept on record but never count toward
  // revenue, profit or any chart.
  const sales = db.sales.filter((s) => !s.cancelled && inRange(s, from, to));

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
  const todaySales = db.sales.filter((s) => !s.cancelled && inRange(s, todayFrom, new Date()));
  const todayRevenue = sum(todaySales, (s) => s.total);
  const todayProfit = sum(todaySales, (s) => s.profit);

  // Daily revenue/profit series across the range, bucketed on the STORE calendar
  // day (Asia/Phnom_Penh). Both the buckets and each sale are keyed with
  // storeToday, so a sale always lands on the shop day it was actually rung up —
  // an 11pm sale stays on tonight, a 2am sale stays on today, not yesterday.
  const seriesMap = new Map<string, { label: string; revenue: number; profit: number }>();
  for (let i = 0; i < days; i++) {
    const key = dayKey(new Date(from.getTime() + i * DAY_MS));
    seriesMap.set(key, { label: shortDay(key), revenue: 0, profit: 0 });
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

  // Per-product sales: units sold, revenue, cost (COGS), VAT and profit.
  //
  // VAT is charged on the whole basket, not the line — so each product's VAT is
  // its share of the invoice VAT, split by the line's revenue. Summed across
  // every product it comes back to the reported VAT total, which is the point:
  // the per-product column has to reconcile to the header figure.
  const prodMap = new Map<string, { name: string; sku: string; qty: number; revenue: number; cost: number; vat: number; profit: number }>();
  for (const s of sales) {
    const saleRevenue = s.items.reduce((a, it) => a + it.price * it.qty, 0);
    for (const it of s.items) {
      const cur = prodMap.get(it.productId) || { name: it.name, sku: it.sku, qty: 0, revenue: 0, cost: 0, vat: 0, profit: 0 };
      const lineRev = it.price * it.qty;
      cur.qty += it.qty;
      cur.revenue = round2(cur.revenue + lineRev);
      cur.cost = round2(cur.cost + it.cost * it.qty);
      cur.vat = round2(cur.vat + (saleRevenue > 0 ? s.tax * (lineRev / saleRevenue) : 0));
      cur.profit = round2(cur.profit + (it.price - it.cost) * it.qty);
      prodMap.set(it.productId, cur);
    }
  }
  // Full list (every product sold in the range) — drives the Excel export.
  const productReport = Array.from(prodMap.entries())
    .map(([id, v]) => ({ id, ...v, margin: v.revenue ? round2((v.profit / v.revenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  // Top slice for the on-screen table.
  const topProducts = productReport.slice(0, 8);

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

  // Hour-of-day distribution — in STORE time, so "14:00" means 2pm in the shop,
  // not 2pm UTC (which is 9pm in Phnom Penh).
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}:00`, revenue: 0 }));
  for (const s of sales) {
    const h = storeHour(new Date(s.createdAt));
    hours[h].revenue = round2(hours[h].revenue + s.total);
  }
  const peakHours = hours.filter((h) => h.hour >= 7 && h.hour <= 21);

  // Sales in 2-hour blocks across the day (00:00–01:59 … 22:00–23:59), store
  // time. `tickets` is the number of transactions in the block ≈ how many
  // customers came through in that window.
  const pad = (n: number) => String(n).padStart(2, "0");
  const salesByBlock = Array.from({ length: 12 }, (_, i) => {
    const start = i * 2;
    return { start, label: `${pad(start)}:00–${pad(start + 1)}:59`, tickets: 0, items: 0, revenue: 0 };
  });
  for (const s of sales) {
    const blk = salesByBlock[Math.floor(storeHour(new Date(s.createdAt)) / 2)];
    blk.tickets += 1;
    blk.items += s.items.reduce((a, it) => a + it.qty, 0);
    blk.revenue = round2(blk.revenue + s.total);
  }

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
    productReport,
    byCategory,
    byPayment,
    peakHours,
    salesByBlock,
    lowStock,
    lowStockCount: lowStock.length,
    inventoryValue,
    retailValue,
    productCount: db.products.length,
    customerCount: db.customers.length,
  };
}

export type Stats = ReturnType<typeof buildStats>;
