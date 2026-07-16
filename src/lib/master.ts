import { promises as fs } from "fs";
import path from "path";
import type { Product, Supplier } from "./types";
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
export async function propagateSuppliersToStores(): Promise<void> {
  const master = await readMasterSuppliers();
  const sys = await readSystem();
  for (const store of sys.stores) {
    await mutateDB((db) => {
      const byCode = new Map((db.suppliers || []).map((s) => [s.code, s]));
      for (const m of master) byCode.set(m.code, { ...m });
      db.suppliers = [...byCode.values()];
      return true;
    }, store.id);
  }
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
