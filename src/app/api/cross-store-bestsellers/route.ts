import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// Best-selling products across ALL OTHER stores, with a recommended opening
// quantity — used to stock a brand-new store. Ranks by units sold; the
// recommendation is the average daily sales per store × the cover window.
//   ?exclude=<storeId>  the new store to leave out (defaults to current store)
//   ?days=30            sales window to learn from
//   ?cover=30           days of stock to recommend for opening
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const exclude = url.searchParams.get("exclude") || s.storeId;
  const days = Math.max(1, Number(url.searchParams.get("days")) || 30);
  const cover = Math.max(1, Number(url.searchParams.get("cover")) || 30);
  // No cap — the shop can request as many SKUs as it wants (0/absent = all).
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : Infinity;

  const sys = await readSystem();
  const now = Date.now();
  const DAY = 86_400_000;

  type Agg = { sku: string; name: string; barcode: string; category: string; units: number; stores: Set<string> };
  const agg = new Map<string, Agg>();
  let storesWithSales = 0;

  for (const store of sys.stores) {
    if (store.id === exclude) continue;
    const db = await readDB(store.id);
    const prodBySku = new Map(db.products.map((p) => [p.sku, p]));
    let sold = false;
    for (const sale of db.sales) {
      if (sale.cancelled) continue; // voided invoices don't count
      const t = new Date(sale.createdAt).getTime();
      if (!Number.isFinite(t) || (now - t) / DAY > days) continue;
      for (const it of sale.items) {
        const key = it.sku;
        const p = prodBySku.get(it.sku);
        const e =
          agg.get(key) ??
          agg
            .set(key, { sku: it.sku, name: it.name, barcode: p?.barcode || "", category: p?.category || "Uncategorized", units: 0, stores: new Set() })
            .get(key)!;
        e.units += it.qty;
        e.stores.add(store.id);
        sold = true;
      }
    }
    if (sold) storesWithSales++;
  }

  const items = [...agg.values()]
    .map((e) => {
      const nStores = Math.max(1, e.stores.size);
      const avgDailyPerStore = e.units / nStores / days;
      const recommendedQty = Math.max(1, Math.ceil(avgDailyPerStore * cover));
      return { sku: e.sku, name: e.name, barcode: e.barcode, category: e.category, units: e.units, stores: e.stores.size, recommendedQty };
    })
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);

  return NextResponse.json({ items, storesWithSales, days, cover });
}
