import { promises as fs } from "fs";
import path from "path";
import type { DB } from "./types";
import { buildSeed } from "./seed";
import { getSession } from "./session";
import { repairBarcodes } from "./barcodes";
import { STORES_DIR, DEFAULT_STORE_ID, readSystem } from "./system";

// One JSON file per store; the active store comes from the logged-in session.
const storeFile = (storeId: string) => path.join(STORES_DIR, `${storeId}.json`);

// In-process write lock so concurrent API calls don't clobber a store file.
let writeChain: Promise<unknown> = Promise.resolve();

// Resolve the store in the REQUEST scope (cookies() needs the request's async
// context — never inside the shared write-lock, which may run under another
// request's context).
async function currentStoreId(override?: string): Promise<string> {
  if (override) return override;
  const s = await getSession();
  return s?.storeId || DEFAULT_STORE_ID;
}

function backfill(db: DB): DB {
  if (!db.suppliers) db.suppliers = [];
  if (!db.purchaseRequests) db.purchaseRequests = [];
  if (!db.purchaseOrders) db.purchaseOrders = [];
  if (!db.goodsReceipts) db.goodsReceipts = [];
  if (!db.stockCounts) db.stockCounts = [];
  if (!db.writeOffs) db.writeOffs = [];
  if (!db.markdowns) db.markdowns = [];
  if (!db.recipes) db.recipes = [];
  if (!db.stockMovements) db.stockMovements = [];
  if (!db.promotions) db.promotions = [];
  if (!db.promotionUsages) db.promotionUsages = [];
  if (!db.auditLog) db.auditLog = [];
  if (db.meta.nextPR == null) db.meta.nextPR = 100002;
  if (db.meta.nextPO == null) db.meta.nextPO = 100021;
  if (db.meta.nextGRN == null) db.meta.nextGRN = 100001;
  if (db.meta.nextStockCount == null) db.meta.nextStockCount = 100001;
  if (db.meta.nextWriteOff == null) db.meta.nextWriteOff = 100001;
  if (db.meta.nextMarkdown == null) db.meta.nextMarkdown = 1;
  if (db.meta.nextRecipe == null) db.meta.nextRecipe = 100001;
  if (db.meta.nextMovement == null) db.meta.nextMovement = 1;
  // Inventory ledger + historical purchases (migration feature) — stores
  // created before them get empty books, not a crash.
  if (!db.ledger) db.ledger = [];
  if (db.meta.nextLedger == null) db.meta.nextLedger = 1;
  if (!db.historicalPurchases) db.historicalPurchases = [];
  if (db.meta.nextHistorical == null) db.meta.nextHistorical = 1;
  // Customer pickup-number queue — stores created before it get an empty book
  // and a zeroed counter (first number issued will be 001).
  if (!db.queue) db.queue = [];
  if (db.meta.nextQueueId == null) db.meta.nextQueueId = 1;
  if (!db.meta.queue) db.meta.queue = { current: 0, updatedAt: new Date().toISOString() };
  // Money management — cash shifts + drawer movements. Stores predating it get
  // empty books and a sensible default drawer ceiling.
  if (!db.shifts) db.shifts = [];
  if (!db.cashMovements) db.cashMovements = [];
  if (db.meta.nextShift == null) db.meta.nextShift = 1;
  if (db.meta.nextCashMovement == null) db.meta.nextCashMovement = 1;
  if (db.meta.business && db.meta.business.cashDrawerLimit == null) db.meta.business.cashDrawerLimit = 500;
  if (db.meta.nextPromotion == null) db.meta.nextPromotion = 100001;
  if (db.meta.nextPromotionUsage == null) db.meta.nextPromotionUsage = 1;
  // Deals don't combine or stack until the owner says so — see lib/promotions.
  if (db.meta.business && !db.meta.business.promotionSettings) {
    db.meta.business.promotionSettings = { allowCombine: false, allowStackWithMarkdown: false };
  }
  if (db.meta.nextAudit == null) db.meta.nextAudit = 1;
  // Every product carries a ranking on its price label; default everything to "A".
  for (const p of db.products || []) {
    if (!p.ranking) p.ranking = "A";
  }
  // The import crammed multi-code products into one field ("A,B"), which every
  // scan compares whole — so those products answered to no code at all. Split
  // them once, here, so scanning is fixed on the next read rather than only
  // after someone remembers to run a master sync.
  if (!db.meta.barcodesSplit) {
    for (const p of db.products || []) repairBarcodes(p);
    db.meta.barcodesSplit = true;
  }
  if (db.meta.business && !db.meta.business.approvers) {
    db.meta.business.approvers = [
      { role: "Manager", name: "", code: "1234" },
      { role: "Assistant Manager", name: "", code: "5678" },
    ];
  }
  // The per-supplier tax rate (taxPct) was added after suppliers were imported —
  // most came in with 0 or no value. Default EVERY supplier to 10% VAT once, then
  // leave each supplier's rate to be managed individually (0 = tax-free supplier).
  if (!db.meta.supplierTaxInitialized) {
    for (const s of db.suppliers) s.taxPct = 10;
    db.meta.supplierTaxInitialized = true;
  }
  return db;
}

async function ensureStoreFile(storeId: string): Promise<void> {
  const file = storeFile(storeId);
  try {
    await fs.access(file);
    return;
  } catch {
    /* seed it */
  }
  const sys = await readSystem();
  const store = sys.stores.find((s) => s.id === storeId);
  // The default store keeps the ON Mart demo data; new stores start clean.
  const seed = buildSeed({ storeName: store?.name, withDemo: storeId === DEFAULT_STORE_ID });
  await fs.mkdir(STORES_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(seed, null, 2), "utf8");
}

export async function readDB(storeId?: string): Promise<DB> {
  const sid = await currentStoreId(storeId);
  await ensureStoreFile(sid);
  const raw = await fs.readFile(storeFile(sid), "utf8");
  return backfill(JSON.parse(raw) as DB);
}

export async function mutateDB<T>(
  mutator: (db: DB) => T | Promise<T>,
  storeId?: string,
): Promise<T> {
  const sid = await currentStoreId(storeId); // captured in request scope
  const run = async (): Promise<T> => {
    await ensureStoreFile(sid);
    const raw = await fs.readFile(storeFile(sid), "utf8");
    const db = backfill(JSON.parse(raw) as DB);
    const result = await mutator(db);
    await fs.writeFile(storeFile(sid), JSON.stringify(db, null, 2), "utf8");
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
}

/** Reset the CURRENT store back to its seed. */
export async function resetDB(storeId?: string): Promise<void> {
  const sid = await currentStoreId(storeId);
  const sys = await readSystem();
  const store = sys.stores.find((s) => s.id === sid);
  const fresh = buildSeed({ storeName: store?.name, withDemo: sid === DEFAULT_STORE_ID });
  await mutateDB((db) => {
    Object.assign(db, fresh);
  }, sid);
}
