import { promises as fs } from "fs";
import path from "path";
import type { Product } from "./types";
import { DATA_DIR, DEFAULT_STORE_ID } from "./system";
import { readDB } from "./db";

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
