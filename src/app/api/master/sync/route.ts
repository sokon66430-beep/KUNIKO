import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMaster, applyMasterFields, propagateSuppliersToStores, reconcileSupplierNames } from "@/lib/master";
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
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const actor = await currentActor();

  // Bring every product's supplier NAME back in line with the supplier record
  // its code points at, BEFORE pushing anything out — otherwise a stale name in
  // the master would be copied into every store as though it were correct.
  const supplierNames = await reconcileSupplierNames();

  const master = await readMaster();
  const masterIds = new Set(master.map((m) => m.id));
  const sys = await readSystem();

  const results: { store: string; added: number; updated: number; removed: number; keptWithStock: number }[] = [];

  for (const store of sys.stores) {
    const r = await mutateDB((db) => {
      const byId = new Map(db.products.map((p) => [p.id, p]));
      let added = 0;
      let updated = 0;
      for (const m of master) {
        const existing = byId.get(m.id);
        if (existing) {
          applyMasterFields(existing, m); // shared fields only
          updated++;
        } else {
          const product: Product = {
            ...m,
            price: Math.max(0, Number(m.price) || 0), // follows master (kept in sync every run)
            reorderLevel: Math.max(0, Number(m.reorderLevel) || 0), // per-store, seeded from master
            stock: 0,
          };
          // Drop the master's shelf location — a new store registers its own on
          // the Price labels page.
          delete product.gondola;
          delete product.shelf;
          delete product.locations;
          db.products.push(product);
          added++;
        }
      }
      // Remove store-only products (not in the master) that hold no stock; keep
      // and report any that still have stock so nothing is lost by surprise.
      let removed = 0;
      let keptWithStock = 0;
      db.products = db.products.filter((p) => {
        if (masterIds.has(p.id)) return true;
        if ((Number(p.stock) || 0) > 0) {
          keptWithStock++;
          return true;
        }
        removed++;
        return false;
      });
      logAudit(db, {
        actor,
        action: "Synced",
        entityType: "Product",
        entity: "Master catalog",
        detail: `${added} added · ${updated} updated · ${removed} removed`,
      });
      return { added, updated, removed, keptWithStock };
    }, store.id);
    results.push({ store: store.name, ...r });
  }

  // Suppliers follow the master too — mirror them into every store.
  await propagateSuppliersToStores();

  return NextResponse.json({ masterCount: master.length, stores: results, supplierNames });
}
