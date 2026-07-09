import { promises as fs } from "fs";
import path from "path";
import type { DB } from "./types";
import { buildSeed } from "./seed";
import { getSession } from "./session";
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
  if (!db.auditLog) db.auditLog = [];
  if (db.meta.nextPR == null) db.meta.nextPR = 100002;
  if (db.meta.nextPO == null) db.meta.nextPO = 100021;
  if (db.meta.nextGRN == null) db.meta.nextGRN = 100001;
  if (db.meta.nextStockCount == null) db.meta.nextStockCount = 100001;
  if (db.meta.nextAudit == null) db.meta.nextAudit = 1;
  if (db.meta.business && !db.meta.business.approvers) {
    db.meta.business.approvers = [
      { role: "Manager", name: "", code: "1234" },
      { role: "Assistant Manager", name: "", code: "5678" },
    ];
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
