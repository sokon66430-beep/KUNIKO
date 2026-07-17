import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterPromotions, propagatePromotionsToStores, promotionRunsIn } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// Push the master promotions into every store (owner-only). Deal edits already
// mirror automatically on save; this re-syncs on demand.
//
// Each store gets only the deals aimed at it, so the response reports the count
// PER STORE rather than one total — "12 promotions synced" would be a lie on a
// shop that runs four of them.
export async function POST() {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await propagatePromotionsToStores();
  const master = await readMasterPromotions();
  const sys = await readSystem();
  return NextResponse.json({
    promotions: master.items.length,
    stores: sys.stores.map((st) => ({
      store: st.name,
      promotions: master.items.filter((p) => promotionRunsIn(p, st.id)).length,
    })),
  });
}
