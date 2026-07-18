import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { readDB } from "@/lib/db";
import { canSeeAllStores } from "@/lib/access";

export const dynamic = "force-dynamic";

// Cross-store overview (owner + Management): one summary row per store, plus totals.
export async function GET() {
  const s = await getSession();
  if (!s || !canSeeAllStores(s.role)) {
    return NextResponse.json({ error: "Leadership only" }, { status: 403 });
  }

  const sys = await readSystem();
  const stores = await Promise.all(
    sys.stores.map(async (st) => {
      const db = await readDB(st.id);
      const products = db.products;
      const invValue = products.reduce((a, p) => a + p.cost * p.stock, 0);
      const retailValue = products.reduce((a, p) => a + p.price * p.stock, 0);
      const lowStock = products.filter(
        (p) => p.trackStock !== false && p.reorderLevel > 0 && p.stock <= p.reorderLevel,
      ).length;
      const openPOs = db.purchaseOrders.filter(
        (p) => p.status === "Open" || p.status === "Partial",
      ).length;
      const salesTotal = db.sales.reduce((a, x) => a + (x.cancelled ? 0 : x.total), 0);
      const staff = sys.users.filter((u) => u.storeId === st.id).length;
      return {
        id: st.id,
        name: st.name,
        products: products.length,
        staff,
        openPOs,
        lowStock,
        salesTotal,
        invValue,
        retailValue,
      };
    }),
  );

  const totals = stores.reduce(
    (t, x) => ({
      stores: stores.length,
      products: t.products + x.products,
      staff: t.staff + x.staff,
      openPOs: t.openPOs + x.openPOs,
      salesTotal: t.salesTotal + x.salesTotal,
      invValue: t.invValue + x.invValue,
    }),
    { stores: 0, products: 0, staff: 0, openPOs: 0, salesTotal: 0, invValue: 0 },
  );

  return NextResponse.json({ stores, totals });
}
