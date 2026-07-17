import type { Markdown, Sale } from "./types";
import { markdownStatus, storeToday, type MarkdownStatus } from "./markdowns";

// ---------------------------------------------------------------------------
// Mark Down report — what happened to every label after it left the shelf.
//
// The Mark Down page only carries LIVE labels (Active + Scheduled), because a
// list that keeps every label ever made stops being a work list. Everything
// that has finished or been pulled early lives here instead: nothing is
// deleted, it just moves from "do this" to "this is what happened".
//
// The numbers are joined from the sale lines, not stored on the markdown. A
// line stamped with `markdownCode` IS the record that a discounted item was
// rung up, and it snapshots `fullPrice` at the time — so this report can't
// drift from what the till actually took.
// ---------------------------------------------------------------------------

export type MarkdownReportRow = {
  id: string;
  code: string;
  productId: string;
  sku: string;
  name: string;
  category?: string;
  percent: number;
  originalPrice: number;
  price: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  createdBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  status: MarkdownStatus;

  qtySold: number; // base units rung up under this label
  revenue: number; // money actually taken
  fullValue: number; // what those same units would have made at full price
  discountGiven: number; // fullValue − revenue: the cost of clearing them
  cost: number;
  profit: number; // revenue − cost (can be negative on a 70% cut)
  lastSoldAt?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Units + money rung up under each markdown label, keyed by label code. */
function soldByCode(sales: Sale[]) {
  const map = new Map<string, { qty: number; revenue: number; fullValue: number; cost: number; lastSoldAt?: string }>();
  for (const s of sales) {
    for (const li of s.items) {
      if (!li.markdownCode) continue;
      const row = map.get(li.markdownCode) || { qty: 0, revenue: 0, fullValue: 0, cost: 0 };
      row.qty += li.qty;
      row.revenue += li.qty * li.price;
      // `fullPrice` is snapshotted on the line; older lines predate it, so fall
      // back to the label's own original price rather than dropping the row.
      row.fullValue += li.qty * (li.fullPrice ?? li.price);
      row.cost += li.qty * li.cost;
      if (!row.lastSoldAt || s.createdAt > row.lastSoldAt) row.lastSoldAt = s.createdAt;
      map.set(li.markdownCode, row);
    }
  }
  return map;
}

export function markdownReportRows(
  markdowns: Markdown[],
  sales: Sale[],
  today: string = storeToday(),
): MarkdownReportRow[] {
  const sold = soldByCode(sales);
  return markdowns
    .map((m) => {
      const s = sold.get(m.code);
      // A label with no sales is a real result, not missing data — it means the
      // cut didn't shift the stock. Those rows must show as zero, not vanish.
      const qtySold = s?.qty ?? 0;
      const revenue = r2(s?.revenue ?? 0);
      const fullValue = r2(s?.fullValue ?? (qtySold ? qtySold * m.originalPrice : 0));
      const cost = r2(s?.cost ?? 0);
      return {
        id: m.id,
        code: m.code,
        productId: m.productId,
        sku: m.sku,
        name: m.name,
        category: m.category,
        percent: m.percent,
        originalPrice: m.originalPrice,
        price: m.price,
        startDate: m.startDate,
        endDate: m.endDate,
        createdAt: m.createdAt,
        createdBy: m.createdBy,
        cancelledAt: m.cancelledAt,
        cancelledBy: m.cancelledBy,
        status: markdownStatus(m, today),
        qtySold,
        revenue,
        fullValue,
        discountGiven: r2(fullValue - revenue),
        cost,
        profit: r2(revenue - cost),
        lastSoldAt: s?.lastSoldAt,
      };
    })
    .sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : +new Date(b.createdAt) - +new Date(a.createdAt)));
}

export type MarkdownReportTotals = {
  labels: number;
  qtySold: number;
  revenue: number;
  discountGiven: number;
  profit: number;
  neverSold: number; // labels that finished without shifting a single unit
};

export function markdownReportTotals(rows: MarkdownReportRow[]): MarkdownReportTotals {
  return {
    labels: rows.length,
    qtySold: rows.reduce((s, r) => s + r.qtySold, 0),
    revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)),
    discountGiven: r2(rows.reduce((s, r) => s + r.discountGiven, 0)),
    profit: r2(rows.reduce((s, r) => s + r.profit, 0)),
    neverSold: rows.filter((r) => r.qtySold === 0 && (r.status === "Expired" || r.status === "Cancelled")).length,
  };
}
