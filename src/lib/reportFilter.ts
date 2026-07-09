import type { PurchaseOrder, PurchaseRequest, GoodsReceipt } from "./types";

export type ReportQuery = {
  from?: string; // yyyy-mm-dd inclusive
  to?: string; // yyyy-mm-dd inclusive
  supplier?: string; // "All" or exact name
  status?: string; // "All" or exact status
  requestedBy?: string; // "All" or exact
};

export function parseQuery(url: string): ReportQuery {
  const p = new URL(url).searchParams;
  const g = (k: string) => {
    const v = p.get(k);
    return v && v !== "All" ? v : undefined;
  };
  return { from: g("from"), to: g("to"), supplier: g("supplier"), status: g("status"), requestedBy: g("requestedBy") };
}

function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = iso.slice(0, 10); // yyyy-mm-dd
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function filterPOs(pos: PurchaseOrder[], q: ReportQuery): PurchaseOrder[] {
  return pos
    .filter((po) => inDateRange(po.createdAt, q.from, q.to))
    .filter((po) => !q.supplier || po.supplier === q.supplier)
    .filter((po) => !q.status || po.status === q.status)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function filterPRs(prs: PurchaseRequest[], q: ReportQuery): PurchaseRequest[] {
  return prs
    .filter((pr) => inDateRange(pr.createdAt, q.from, q.to))
    .filter((pr) => !q.status || pr.status === q.status)
    .filter((pr) => !q.requestedBy || pr.requestedBy === q.requestedBy)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function filterGRNs(grns: GoodsReceipt[], q: ReportQuery): GoodsReceipt[] {
  return grns
    .filter((g) => inDateRange(g.createdAt, q.from, q.to))
    .filter((g) => !q.supplier || g.supplier === q.supplier)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function filterNote(q: ReportQuery): string {
  const parts: string[] = [];
  parts.push(q.from || q.to ? `Period: ${q.from || "start"} → ${q.to || "today"}` : "Period: all dates");
  if (q.supplier) parts.push(`Supplier: ${q.supplier}`);
  if (q.status) parts.push(`Status: ${q.status}`);
  if (q.requestedBy) parts.push(`Requested by: ${q.requestedBy}`);
  return parts.join("   ·   ");
}
