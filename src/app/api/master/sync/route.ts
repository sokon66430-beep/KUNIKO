import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import {
  readMaster,
  applyMasterFields,
  propagateSuppliersToStores,
  reconcileSupplierNames,
  repairMasterBarcodes,
  propagateRecipesToStores,
  propagatePromotionsToStores,
  readMasterRecipes,
  readMasterPromotions,
  parseStoreIds,
  syncMasterIntoStore,
} from "@/lib/master";
import { readSystem } from "@/lib/system";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

// Push the master catalog into every store so each store is an exact mirror of
// the master. Shared fields (name, barcode, category, cost, selling PRICE,
// supplier…) are copied — every store follows the master, including price. Each
// store keeps its own reorder level, stock and shelf LOCATION (registered per
// store on the Price labels page). New master products are added (stock 0, no
// location, reorder seeded from the master).
//
// The master is the single source of truth, so products a store has that AREN'T
// in the master are removed — EXCEPT any that still hold stock, which are kept
// (never silently lose inventory) and reported back as "keptWithStock" so the
// owner can add them to the master or write them off first.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await masterDataFor(session.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const actor = await currentActor();

  // Bring every product's supplier NAME back in line with the supplier record
  // its code points at, BEFORE pushing anything out — otherwise a stale name in
  // the master would be copied into every store as though it were correct.
  const supplierNames = await reconcileSupplierNames();
  // Same reason: `barcode` is master-owned, so the master has to be repaired
  // before it pushes, or it would copy the unscannable "A,B" over every store.
  const barcodesFixed = await repairMasterBarcodes();

  const master = await readMaster();
  const masterIds = new Set(master.map((m) => m.id));
  const sys = await readSystem();

  // ?storeIds=a,b pushes to just those shops — the repair case, where a store's
  // catalog looks wrong and rewriting the rest to fix it would be a bigger move
  // than the problem. None named means every store, which is what this button
  // has always done.
  const target = await parseStoreIds(req.url);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
  const targetIds = new Set(target.stores.map((s) => s.id));
  const stores = sys.stores.filter((s) => targetIds.has(s.id));

  const results: { store: string; added: number; updated: number; removed: number; keptWithStock: number }[] = [];

  // One shared implementation with the till's Sync catalogue — see
  // syncMasterIntoStore. It also mirrors suppliers, recipes and promotions into
  // each store it touches.
  for (const store of stores) {
    const r = await syncMasterIntoStore(store.id, actor);
    results.push({ store: store.name, ...r });
  }

  // Suppliers, recipes and promotions are mirrored by syncMasterIntoStore, once
  // per store in the loop above — and only into the stores this run targets, so
  // "sync PDK" still can't rewrite the other two shops' supplier lists. These
  // are read here purely for the counts in the reply.
  const recipes = (await readMasterRecipes()).items.length;
  const promotions = (await readMasterPromotions()).items.length;

  return NextResponse.json({
    masterCount: master.length,
    stores: results,
    supplierNames,
    barcodesFixed,
    recipes,
    promotions,
  });
}
