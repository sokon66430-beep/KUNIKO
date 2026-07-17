import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterPromotions, propagatePromotionsToStores, promotionRunsIn } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// POST /api/master/promotions/sync?storeId=  — push the master promotions into
// every store, or just the one named (owner-only).
//
// Deal edits already mirror automatically on save; this re-syncs on demand.
//
// Each store gets only the deals aimed at it, so the response reports the count
// PER STORE rather than one total — "12 promotions synced" would be a lie on a
// shop that runs four of them.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get("storeId") || undefined;
  const sys = await readSystem();
  // Checked before the push: an unknown id syncs NOTHING, and reporting that as
  // success would look like it worked.
  const target = storeId ? sys.stores.find((st) => st.id === storeId) : undefined;
  if (storeId && !target) return NextResponse.json({ error: "No such store." }, { status: 400 });

  await propagatePromotionsToStores(storeId);
  const master = await readMasterPromotions();
  const touched = target ? [target] : sys.stores;
  return NextResponse.json({
    promotions: master.items.length,
    stores: touched.map((st) => ({
      store: st.name,
      promotions: master.items.filter((p) => promotionRunsIn(p, st.id)).length,
    })),
  });
}
