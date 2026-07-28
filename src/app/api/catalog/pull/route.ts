import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canSyncCatalog } from "@/lib/access";
import { currentActor } from "@/lib/actor";
import { syncMasterIntoStore } from "@/lib/master";

export const dynamic = "force-dynamic";

/**
 * Pull the master catalogue down into THIS store.
 *
 * The till's "Sync catalogue" button. Prices, names and barcodes are owned
 * centrally in Master Data; a store only sees an edit once the master has been
 * copied into it. Before this, the till's sync re-read the store's OWN product
 * list — so a price corrected in Master Data an hour earlier was still invisible
 * at the counter until someone in the office remembered to press Sync to stores.
 *
 * Two limits, both deliberate:
 *
 *  - THIS store only, taken from the session — never a store id from the
 *    request. A till must not be able to rewrite another shop's catalogue.
 *
 *  - Gated on canSyncCatalog (owner, procurement), NOT on Master Data access.
 *    This route only COPIES the master as it already stands; it cannot change
 *    it. Requiring the editing capability would mean granting procurement the
 *    right to rewrite the company file just so they could refresh a till.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canSyncCatalog(session.role)) {
    return NextResponse.json({ error: "Only the owner or procurement can sync the catalogue." }, { status: 403 });
  }

  const actor = await currentActor();
  try {
    const counts = await syncMasterIntoStore(session.storeId, actor);
    return NextResponse.json({ store: session.storeName, ...counts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Catalogue sync failed" }, { status: 500 });
  }
}
