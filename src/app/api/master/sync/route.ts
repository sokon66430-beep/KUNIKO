import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMaster, applyMasterFields } from "@/lib/master";
import { readSystem } from "@/lib/system";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

// Push the master catalog into every store. Shared fields (name, barcode,
// category, cost, supplier…) are copied; each store's own price, reorder level,
// stock and shelf LOCATION are left untouched — location is registered per store
// on the Price labels page, never dictated by the master. New master products
// are added (stock 0, no location, price/reorder seeded from the master as a
// starting point). Nothing is ever deleted — products a store has that aren't in
// the master are just reported as "extra", so no stock or history is lost.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const actor = await currentActor();

  const master = await readMaster();
  const masterIds = new Set(master.map((m) => m.id));
  const sys = await readSystem();

  const results: { store: string; added: number; updated: number; extra: number }[] = [];

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
            price: Math.max(0, Number(m.price) || 0), // per-store, seeded from master
            reorderLevel: Math.max(0, Number(m.reorderLevel) || 0),
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
      const extra = db.products.filter((p) => !masterIds.has(p.id)).length;
      logAudit(db, {
        actor,
        action: "Synced",
        entityType: "Product",
        entity: "Master catalog",
        detail: `${added} added · ${updated} updated`,
      });
      return { added, updated, extra };
    }, store.id);
    results.push({ store: store.name, ...r });
  }

  return NextResponse.json({ masterCount: master.length, stores: results });
}
