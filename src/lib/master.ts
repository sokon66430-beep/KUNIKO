import { promises as fs } from "fs";
import path from "path";
import type { Product, Supplier, Recipe, Promotion } from "./types";
import { repairBarcodes } from "./barcodes";
import { DATA_DIR, DEFAULT_STORE_ID, readSystem } from "./system";
import { readDB, mutateDB } from "./db";

// The central product catalog shared by every store. Lives on the persistent
// disk (DATA_DIR) so it survives deploys. Seeded from the default store's
// current products the first time it's read, so the owner's existing catalog
// becomes the master with nothing lost.
const MASTER_FILE = path.join(DATA_DIR, "master-products.json");
let masterWriteChain: Promise<unknown> = Promise.resolve();

// Fields the master OWNS and pushes to stores on sync. Selling price is central
// too — every store follows the master price. Everything not listed stays per
// store: reorderLevel, stock, trackStock, shelf LOCATION (gondola/shelf/
// locations — every store has its own layout), and all transactional data
// (sales/PO/receipts…).
export const MASTER_FIELDS: (keyof Product)[] = [
  "sku",
  "name",
  "nameKh",
  "barcode",
  "altBarcodes", // travels with `barcode` — a product's codes are one fact, not two
  "category",
  "unit",
  "cost",
  "price",
  "ranking",
  "groupCode",
  "subGroupCode",
  "catCode",
  "shelfLifeDays",
  "supplier",
  "supplierCode",
  "showOnPos", // which items the cashier can tap at the till
  "image", // product photo shown on the POS tile
];

async function ensureMaster(): Promise<void> {
  try {
    await fs.access(MASTER_FILE);
    return;
  } catch {
    /* seed below */
  }
  let seed: Product[] = [];
  try {
    const db = await readDB(DEFAULT_STORE_ID);
    seed = db.products.map((p) => ({ ...p }));
  } catch {
    seed = [];
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MASTER_FILE, JSON.stringify(seed, null, 2), "utf8");
}

export async function readMaster(): Promise<Product[]> {
  await ensureMaster();
  const raw = await fs.readFile(MASTER_FILE, "utf8");
  return JSON.parse(raw) as Product[];
}

export async function mutateMaster<T>(mutator: (products: Product[]) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureMaster();
    const raw = await fs.readFile(MASTER_FILE, "utf8");
    const products = JSON.parse(raw) as Product[];
    const result = await mutator(products);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MASTER_FILE, JSON.stringify(products, null, 2), "utf8");
    return result;
  };
  const next = masterWriteChain.then(run, run);
  masterWriteChain = next.catch(() => undefined);
  return next;
}

// Copy the master-owned fields of `m` onto a store product `target`, leaving
// the per-store fields (price, reorderLevel, stock…) untouched.
export function applyMasterFields(target: Product, m: Product): void {
  for (const f of MASTER_FIELDS) {
    (target as any)[f] = (m as any)[f];
  }
}

// ---------------------------------------------------------------------------
// Master SUPPLIERS — the single source of truth. Managed only in Master Data
// (owner-only) and mirrored into every store's supplier list so PO / receiving,
// which read the per-store list, always see the master's suppliers. Seeded from
// the default store's suppliers the first time it's read.
// ---------------------------------------------------------------------------
const MASTER_SUPPLIERS_FILE = path.join(DATA_DIR, "master-suppliers.json");
let masterSupWriteChain: Promise<unknown> = Promise.resolve();

async function ensureMasterSuppliers(): Promise<void> {
  try {
    await fs.access(MASTER_SUPPLIERS_FILE);
    return;
  } catch {
    /* seed below */
  }
  let seed: Supplier[] = [];
  try {
    const db = await readDB(DEFAULT_STORE_ID);
    seed = (db.suppliers || []).map((s) => ({ ...s }));
  } catch {
    seed = [];
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MASTER_SUPPLIERS_FILE, JSON.stringify(seed, null, 2), "utf8");
}

export async function readMasterSuppliers(): Promise<Supplier[]> {
  await ensureMasterSuppliers();
  const raw = await fs.readFile(MASTER_SUPPLIERS_FILE, "utf8");
  return JSON.parse(raw) as Supplier[];
}

export async function mutateMasterSuppliers<T>(mutator: (suppliers: Supplier[]) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureMasterSuppliers();
    const raw = await fs.readFile(MASTER_SUPPLIERS_FILE, "utf8");
    const suppliers = JSON.parse(raw) as Supplier[];
    const result = await mutator(suppliers);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MASTER_SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2), "utf8");
    return result;
  };
  const next = masterSupWriteChain.then(run, run);
  masterSupWriteChain = next.catch(() => undefined);
  return next;
}

// Upsert every master supplier into every store's list (by code). Products keep
// their supplier NAME as text, so a store never loses a reference. Store-only
// suppliers (not in the master) are left in place — a delete is handled
// separately via removeSupplierFromStores so nothing vanishes by surprise.
/**
 * Which stores a push should touch.
 *
 * Every propagate below takes an optional `storeId`. Left out — which is what
 * every save does — it means all of them, so a normal edit still reaches the
 * whole chain. Naming one is the repair case: a single shop's copy looks wrong
 * and you'd rather not rewrite the others to fix it.
 *
 * An id that matches nothing yields an EMPTY list, not every store. A typo'd id
 * quietly rewriting all three shops is the opposite of what was asked for.
 */
async function targetStores(storeId?: string) {
  const sys = await readSystem();
  return storeId ? sys.stores.filter((s) => s.id === storeId) : sys.stores;
}

export async function propagateSuppliersToStores(storeId?: string): Promise<void> {
  const master = await readMasterSuppliers();
  for (const store of await targetStores(storeId)) {
    await mutateDB((db) => {
      const byCode = new Map((db.suppliers || []).map((s) => [s.code, s]));
      for (const m of master) byCode.set(m.code, { ...m });
      db.suppliers = [...byCode.values()];
      return true;
    }, store.id);
  }
}

/**
 * Rewrite the supplier NAME on every product linked to `code`.
 *
 * A product carries both `supplierCode` (the link) and `supplier` (the name, as
 * display text). Renaming a supplier therefore has to rewrite that text or the
 * catalogue keeps showing a name that no longer exists — which is exactly the
 * free-text drift the supplier master was introduced to stop.
 *
 * Deliberately does NOT touch purchase requests, purchase orders or receipts:
 * those lines are a frozen snapshot of what the document said when it was
 * raised, and a PO the supplier already holds must keep reading the way they
 * received it.
 */
export async function propagateSupplierRename(code: string, name: string): Promise<number> {
  let touched = 0;
  await mutateMaster((products) => {
    for (const p of products) {
      if (p.supplierCode === code && p.supplier !== name) {
        p.supplier = name;
        touched++;
      }
    }
    return true;
  });
  const sys = await readSystem();
  for (const store of sys.stores) {
    await mutateDB((db) => {
      for (const p of db.products) {
        if (p.supplierCode === code) p.supplier = name;
      }
      return true;
    }, store.id);
  }
  return touched;
}

/**
 * Re-derive every master product's supplier NAME from the supplier record its
 * `supplierCode` points at, and report what was out of step.
 *
 * The repair pass for drift that already exists — a rename done before renames
 * cascaded, or a name edited straight into a product. The CODE is the link and
 * is treated as the truth; the name is only ever a copy of it, so reconciling
 * one way is safe.
 *
 * Products whose code matches no supplier are left alone and counted: that's a
 * broken link, a different problem, and blanking the name would destroy the only
 * clue to what it should be.
 */
export async function reconcileSupplierNames(): Promise<{ fixed: number; unlinked: number }> {
  const suppliers = await readMasterSuppliers();
  const byCode = new Map(suppliers.map((s) => [s.code, s.name]));
  let fixed = 0;
  let unlinked = 0;
  await mutateMaster((products) => {
    for (const p of products) {
      if (!p.supplierCode) continue;
      const name = byCode.get(p.supplierCode);
      if (!name) {
        unlinked++;
        continue;
      }
      if (p.supplier !== name) {
        p.supplier = name;
        fixed++;
      }
    }
    return true;
  });
  return { fixed, unlinked };
}

/**
 * Split any master product whose codes are still crammed into one field.
 *
 * The import wrote "A,B" into `barcode`, and every scan compares the whole
 * field for equality — so those products answered to no code at all. This puts
 * the first code in `barcode` and the rest in `altBarcodes`, which is what the
 * scanners actually read.
 *
 * Runs in sync, BEFORE the push: `barcode` is a master-owned field, so a store
 * repaired on its own would just have the broken value copied back over it.
 */
export async function repairMasterBarcodes(): Promise<number> {
  let fixed = 0;
  await mutateMaster((products) => {
    for (const p of products) if (repairBarcodes(p)) fixed++;
    return true;
  });
  return fixed;
}

// Remove a supplier from every store's list (used when it's deleted from the
// master). Only called once the master delete has confirmed nothing is linked.
export async function removeSupplierFromStores(code: string): Promise<void> {
  const sys = await readSystem();
  for (const store of sys.stores) {
    await mutateDB((db) => {
      db.suppliers = (db.suppliers || []).filter((s) => s.code !== code);
      return true;
    }, store.id);
  }
}

// ---------------------------------------------------------------------------
// Recipes and promotions — central, like the catalog
//
// Both used to live per store, so a chain running three shops had to key the
// same "Beef Noodle" recipe and the same "buy 2 get 1" deal three times, and
// nothing kept them honest afterwards. They're master-owned now: written once
// here, mirrored into every store.
//
// Stores still hold a full copy rather than reading the master at the till. The
// POS, the sale route and the reports all read `db.recipes` / `db.promotions`
// on the hot path, and a deal has to resolve while a customer is standing
// there — so the copy is the cache, and the master is the truth.
//
// Each file keeps its own `next` counter. The per-store counters can't be
// reused: two stores minting from their own sequence both produce rcp100001 for
// different recipes, which is exactly the collision the migration below has to
// clean up once.
// ---------------------------------------------------------------------------

const MASTER_RECIPES_FILE = path.join(DATA_DIR, "master-recipes.json");
const MASTER_PROMOTIONS_FILE = path.join(DATA_DIR, "master-promotions.json");
let masterRecipeWriteChain: Promise<unknown> = Promise.resolve();
let masterPromoWriteChain: Promise<unknown> = Promise.resolve();

export type MasterRecipes = { next: number; items: Recipe[] };
export type MasterPromotions = { next: number; items: Promotion[] };

/**
 * Build the master recipe list from what the stores already have.
 *
 * Runs ONCE, the first time the master file is read. It can't just take the
 * default store's list the way the product master does: a recipe written at one
 * shop and never copied to the others would be dropped, and the mirror would
 * then delete it everywhere. So every store is adopted.
 *
 * Two things have to be resolved while adopting:
 *
 *  - The same recipe keyed at two shops (same name) becomes ONE master recipe.
 *  - Two DIFFERENT recipes that happen to share an id — both stores minted
 *    #100001 from their own counter — can't both keep it, so the later one is
 *    re-numbered.
 *
 * Either way a store's `product.recipeId` may now point at an id that no longer
 * means what it did, so every link is rewired in the same pass. Nothing is
 * dropped, and no product is left pointing at a recipe that isn't there.
 */
async function seedMasterRecipes(): Promise<MasterRecipes> {
  const sys = await readSystem();
  const items: Recipe[] = [];
  const byId = new Map<string, Recipe>();
  const byName = new Map<string, Recipe>();
  const remap = new Map<string, Map<string, string>>(); // storeId -> (old id -> master id)

  // Start past the highest counter any store reached, so a re-numbered recipe
  // can never take an id a store has already handed out.
  let next = 100001;
  for (const store of sys.stores) {
    try {
      const db = await readDB(store.id);
      next = Math.max(next, Number(db.meta?.nextRecipe) || 100001);
    } catch {
      /* a store that will not load cannot contribute a counter */
    }
  }

  for (const store of sys.stores) {
    const map = new Map<string, string>();
    remap.set(store.id, map);
    let db;
    try {
      db = await readDB(store.id);
    } catch {
      continue;
    }
    for (const r of db.recipes || []) {
      const key = (r.name || "").trim().toLowerCase();
      const twin = byName.get(key);
      if (twin) {
        map.set(r.id, twin.id); // same recipe, keyed twice — point at the one copy
        continue;
      }
      const adopted: Recipe = { ...r, items: (r.items || []).map((i) => ({ ...i })) };
      if (byId.has(adopted.id)) {
        adopted.id = `rcp${next}`;
        adopted.code = `RCP-${next}`;
        next += 1;
      }
      byId.set(adopted.id, adopted);
      byName.set(key, adopted);
      items.push(adopted);
      map.set(r.id, adopted.id);
    }
  }

  // Rewire the menu links that just moved.
  for (const store of sys.stores) {
    const map = remap.get(store.id);
    if (!map || map.size === 0) continue;
    try {
      await mutateDB((db) => {
        for (const p of db.products) {
          const to = p.recipeId ? map.get(p.recipeId) : undefined;
          if (to && to !== p.recipeId) p.recipeId = to;
        }
        return true;
      }, store.id);
    } catch {
      /* nothing to rewire in a store that will not load */
    }
  }

  return { next, items };
}

/** Same idea for promotions — no product points at one, so nothing to rewire. */
async function seedMasterPromotions(): Promise<MasterPromotions> {
  const sys = await readSystem();
  const items: Promotion[] = [];
  const byId = new Map<string, Promotion>();
  const byName = new Map<string, Promotion>();

  let next = 100001;
  for (const store of sys.stores) {
    try {
      const db = await readDB(store.id);
      next = Math.max(next, Number(db.meta?.nextPromotion) || 100001);
    } catch {
      /* skip */
    }
  }

  for (const store of sys.stores) {
    let db;
    try {
      db = await readDB(store.id);
    } catch {
      continue;
    }
    for (const p of db.promotions || []) {
      const key = (p.name || "").trim().toLowerCase();
      if (byName.has(key)) continue;
      const adopted: Promotion = { ...p, scope: JSON.parse(JSON.stringify(p.scope)) };
      if (byId.has(adopted.id)) {
        adopted.id = `prm${next}`;
        adopted.code = `PRM-${next}`;
        next += 1;
      }
      byId.set(adopted.id, adopted);
      byName.set(key, adopted);
      items.push(adopted);
    }
  }

  return { next, items };
}

async function ensureMasterRecipes(): Promise<void> {
  try {
    await fs.access(MASTER_RECIPES_FILE);
    return;
  } catch {
    /* seed below */
  }
  let seed: MasterRecipes = { next: 100001, items: [] };
  try {
    seed = await seedMasterRecipes();
  } catch {
    /* an empty master is recoverable; a half-written one is not */
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MASTER_RECIPES_FILE, JSON.stringify(seed, null, 2), "utf8");
}

async function ensureMasterPromotions(): Promise<void> {
  try {
    await fs.access(MASTER_PROMOTIONS_FILE);
    return;
  } catch {
    /* seed below */
  }
  let seed: MasterPromotions = { next: 100001, items: [] };
  try {
    seed = await seedMasterPromotions();
  } catch {
    /* as above */
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MASTER_PROMOTIONS_FILE, JSON.stringify(seed, null, 2), "utf8");
}

export async function readMasterRecipes(): Promise<MasterRecipes> {
  await ensureMasterRecipes();
  const raw = await fs.readFile(MASTER_RECIPES_FILE, "utf8");
  return JSON.parse(raw) as MasterRecipes;
}

export async function mutateMasterRecipes<T>(mutator: (m: MasterRecipes) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureMasterRecipes();
    const raw = await fs.readFile(MASTER_RECIPES_FILE, "utf8");
    const m = JSON.parse(raw) as MasterRecipes;
    const result = await mutator(m);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MASTER_RECIPES_FILE, JSON.stringify(m, null, 2), "utf8");
    return result;
  };
  const next = masterRecipeWriteChain.then(run, run);
  masterRecipeWriteChain = next.catch(() => undefined);
  return next;
}

export async function readMasterPromotions(): Promise<MasterPromotions> {
  await ensureMasterPromotions();
  const raw = await fs.readFile(MASTER_PROMOTIONS_FILE, "utf8");
  return JSON.parse(raw) as MasterPromotions;
}

export async function mutateMasterPromotions<T>(mutator: (m: MasterPromotions) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureMasterPromotions();
    const raw = await fs.readFile(MASTER_PROMOTIONS_FILE, "utf8");
    const m = JSON.parse(raw) as MasterPromotions;
    const result = await mutator(m);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MASTER_PROMOTIONS_FILE, JSON.stringify(m, null, 2), "utf8");
    return result;
  };
  const next = masterPromoWriteChain.then(run, run);
  masterPromoWriteChain = next.catch(() => undefined);
  return next;
}

/**
 * Mirror the master recipes into every store, replacing what's there.
 *
 * A straight replace is safe ONLY because the seed above adopted every store's
 * recipes first — so by the time anything mirrors, the master already holds
 * them. Without that, this would be a silent delete.
 */
export async function propagateRecipesToStores(storeId?: string): Promise<void> {
  const master = await readMasterRecipes();
  for (const store of await targetStores(storeId)) {
    await mutateDB((db) => {
      db.recipes = master.items.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) }));
      db.meta.nextRecipe = master.next;
      return true;
    }, store.id);
  }
}

/**
 * Mirror the master promotions into every store — but only the ones that shop
 * actually runs.
 *
 * This is where `storeIds` is ENFORCED. A store is given only the deals aimed
 * at it, so the till, the sale route and the reports keep reading db.promotions
 * exactly as before and never have to know that stores can be targeted. A deal
 * that can't reach the counter can't fire there by mistake.
 *
 * No storeIds means every store, including ones opened after the deal was
 * written.
 */
export function promotionRunsIn(p: Promotion, storeId: string): boolean {
  return !p.storeIds || p.storeIds.length === 0 || p.storeIds.includes(storeId);
}

export async function propagatePromotionsToStores(storeId?: string): Promise<void> {
  const master = await readMasterPromotions();
  for (const store of await targetStores(storeId)) {
    await mutateDB((db) => {
      db.promotions = master.items
        .filter((p) => promotionRunsIn(p, store.id))
        .map((p) => ({ ...p, scope: JSON.parse(JSON.stringify(p.scope)) }));
      db.meta.nextPromotion = master.next;
      return true;
    }, store.id);
  }
}
