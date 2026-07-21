import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { readMasterPromotions, propagatePromotionsToStores, promotionRunsIn, parseStoreIds } from "@/lib/master";

export const dynamic = "force-dynamic";

// POST /api/master/promotions/sync?storeIds=a,b  — push the master promotions
// into the named stores, or every store when none are named (owner-only).
//
// Deal edits already mirror automatically on save; this re-syncs on demand.
//
// Each store gets only the deals aimed at it, so the response reports the count
// PER STORE rather than one total — "12 promotions synced" would be a lie on a
// shop that runs four of them.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || !(await masterDataFor(s.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });

  const target = await parseStoreIds(req.url);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  await propagatePromotionsToStores(target.ids);
  const master = await readMasterPromotions();
  return NextResponse.json({
    promotions: master.items.length,
    stores: target.stores.map((st) => ({
      store: st.name,
      promotions: master.items.filter((p) => promotionRunsIn(p, st.id)).length,
    })),
  });
}
