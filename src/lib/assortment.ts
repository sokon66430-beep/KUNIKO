import type { DB, Product } from "./types";

// ---------------------------------------------------------------------------
// What this store actually carries.
//
// Master Sync pushes the WHOLE catalog (4,000+ products) into every store, but
// a branch only ranges a fraction of it. Its real assortment isn't declared
// anywhere — it's implied by the store's own paper trail: anything it has in
// stock, has sold, has asked for (PR), has ordered (PO), has received, has
// written off, has put on markdown, or has ever counted.
//
// Built for the stock count, where the difference is the whole point: a count
// sheet of 4,250 rows for a store that carries 800 buries the real work in
// 3,400 rows nobody should touch, and "0 of 4,250 counted" tells the team
// nothing about how far through THEIR shop they are.
//
// A count deliberately still accepts a scan of anything in the catalog — an
// item on the shelf IS in the store, whatever the history says — and scanning
// it adds it to the count, which adds it to this set.
// ---------------------------------------------------------------------------

export function assortmentIds(db: DB): Set<string> {
  const ids = new Set<string>();
  // Negative stock counts too — it's wrong, but it's evidence the store deals
  // in the item, and a count is exactly where it gets corrected.
  for (const p of db.products) if (p.stock !== 0) ids.add(p.id);
  for (const s of db.sales) for (const it of s.items) ids.add(it.productId);
  for (const pr of db.purchaseRequests) for (const it of pr.items) ids.add(it.productId);
  for (const po of db.purchaseOrders) for (const it of po.items) ids.add(it.productId);
  for (const g of db.goodsReceipts) for (const it of g.items) ids.add(it.productId);
  for (const w of db.writeOffs) ids.add(w.productId);
  for (const m of db.markdowns) ids.add(m.productId);
  for (const c of db.stockCounts) for (const it of c.items) ids.add(it.productId);
  return ids;
}

/** The store's carried products, in catalog order. */
export function assortment(db: DB): Product[] {
  const ids = assortmentIds(db);
  return db.products.filter((p) => ids.has(p.id));
}
