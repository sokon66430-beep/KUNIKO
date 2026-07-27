import type { DB } from "./types";
import { buildSeed } from "./seed";
import { getSession } from "./session";
import { repairBarcodes } from "./barcodes";
import { DEFAULT_STORE_ID, readSystem } from "./system";
import { readBlob, writeBlob } from "./blobStore";

// In-process write lock so concurrent API calls don't clobber a store's document.
// A PER-STORE write lock. Each store serializes its own writes (they mutate that
// store's one cached object, so they must run one at a time), but different
// stores run fully in parallel — one busy store never blocks the other 99. This
// is what lets many stores sell at the same time.
const writeChains = new Map<string, Promise<unknown>>();

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
  if (!db.kitchenStations) db.kitchenStations = [];
  if (db.meta.nextQueueId == null) db.meta.nextQueueId = 1;
  if (!db.meta.queue) db.meta.queue = { current: 0, updatedAt: new Date().toISOString() };
  // Money management — cash shifts + drawer movements. Stores predating it get
  // empty books and a sensible default drawer ceiling.
  if (!db.shifts) db.shifts = [];
  if (!db.cashMovements) db.cashMovements = [];
  if (!db.surveys) db.surveys = [];
  if (db.meta.nextShift == null) db.meta.nextShift = 1;
  if (db.meta.nextCashMovement == null) db.meta.nextCashMovement = 1;
  if (db.meta.nextSurvey == null) db.meta.nextSurvey = 1;
  if (db.meta.business && db.meta.business.cashDrawerLimit == null) db.meta.business.cashDrawerLimit = 500;
  if (db.meta.nextPromotion == null) db.meta.nextPromotion = 100001;
  if (db.meta.nextPromotionUsage == null) db.meta.nextPromotionUsage = 1;
  // Coupons — the voucher a customer hands over. Stores that existed before
  // them open with an empty book rather than failing to load.
  if (!db.coupons) db.coupons = [];
  if (!db.couponRedemptions) db.couponRedemptions = [];
  if (db.meta.nextCoupon == null) db.meta.nextCoupon = 1;
  if (db.meta.nextCouponRedemption == null) db.meta.nextCouponRedemption = 1;
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
  // Older goods-receipt lines carried no cost of their own, so their documents
  // fell back to the product's CURRENT cost — a received PO's price then quietly
  // changed whenever the product's price did. Freeze those legacy receipts once,
  // at the product's current cost (what they already display), so from here on a
  // received PO's price is a true snapshot. New receipts already store their cost
  // at the moment of receipt, so this only touches the old ones.
  if (!db.meta.grnCostsFrozen) {
    const costById = new Map((db.products || []).map((p) => [p.id, p.cost]));
    for (const g of db.goodsReceipts || []) {
      for (const it of g.items || []) {
        if (it.cost == null) {
          const c = costById.get(it.productId);
          if (c != null) it.cost = c;
        }
      }
    }
    db.meta.grnCostsFrozen = true;
  }
  // "Created by" was added after these orders were raised. Backfill it from the
  // "Created" audit entry so an existing PO still shows who placed it. Same
  // idempotent rule as "Sent by" below: only fills blanks, and an order with no
  // audit record is left unknown rather than credited to the wrong person.
  for (const po of db.purchaseOrders || []) {
    if (po.createdBy) continue;
    const ev = (db.auditLog || []).find(
      (a) => a.entityType === "PO" && a.entity === po.poNo && a.action === "Created",
    );
    if (ev) po.createdBy = ev.actor;
  }
  // "Sent by" was added after some POs were already marked sent. Backfill who
  // sent each of those from the most recent "Marked sent" audit entry, so the
  // list shows accountability for old orders too. Idempotent (only fills blanks;
  // if there's no audit record we simply leave it unknown).
  for (const po of db.purchaseOrders || []) {
    if (po.sentToSupplier && !po.sentBy) {
      const ev = [...(db.auditLog || [])]
        .reverse()
        .find((a) => a.entityType === "PO" && a.entity === po.poNo && a.action === "Marked sent");
      if (ev) {
        po.sentBy = ev.actor;
        po.sentAt = ev.at;
      }
    }
  }
  // Job Schedule (workforce management). Stores predating it get empty books and,
  // once, the three default shifts + the standard retail station/position lists —
  // so a store manager can start rostering immediately (and still edit any of it).
  if (!db.scheduleEmployees) db.scheduleEmployees = [];
  if (!db.rosterEntries) db.rosterEntries = [];
  if (!db.shiftTemplates) db.shiftTemplates = [];
  if (!db.stations) db.stations = [];
  if (!db.positions) db.positions = [];
  if (db.meta.nextScheduleEmployee == null) db.meta.nextScheduleEmployee = 1;
  if (db.meta.nextRosterEntry == null) db.meta.nextRosterEntry = 1;
  if (!db.meta.scheduleSeeded) {
    if (db.shiftTemplates.length === 0) {
      db.shiftTemplates = [
        { id: "SHT-1", name: "Morning", code: 1, startTime: "06:30", endTime: "15:30", color: "amber", status: "active" },
        { id: "SHT-2", name: "Afternoon", code: 2, startTime: "13:30", endTime: "22:30", color: "brand", status: "active" },
        { id: "SHT-3", name: "Night", code: 3, startTime: "22:00", endTime: "07:00", overnight: true, color: "violet", status: "active" },
      ];
    }
    if (db.stations.length === 0) {
      db.stations = ["Checkout", "Drink", "Hot Food", "Refill & Storage", "Stock Room", "Management"].map((name, i) => ({
        id: `STN-${i + 1}`,
        name,
      }));
    }
    if (db.positions.length === 0) {
      db.positions = ["Store Manager", "Assistant Manager", "Supervisor", "Cashier", "Store Crew"].map((name, i) => ({
        id: `POS-${i + 1}`,
        name,
      }));
    }
    db.meta.scheduleSeeded = true;
  }
  return db;
}

// Seed a brand-new store's document (used the first time a store is opened).
async function seedStore(storeId: string): Promise<DB> {
  const sys = await readSystem();
  const store = sys.stores.find((s) => s.id === storeId);
  // The default store keeps the ON Mart demo data; new stores start clean.
  const seed = buildSeed({ storeName: store?.name, withDemo: storeId === DEFAULT_STORE_ID });
  await writeBlob("store", storeId, JSON.stringify(seed));
  return backfill(seed as DB);
}

// In-memory cache of each store's parsed DB.
//
// The store document holds THOUSANDS of products; re-reading and re-parsing it
// (and re-running backfill over every product) on every single request was
// churning so much memory that the instance was being OOM-killed (exit 139) in a
// loop. One web instance owns the data, so a per-store cache is safe: reads
// reuse the parsed object, and writes mutate that SAME object in place before
// persisting — so the cache never drifts from the store. A failed write drops
// the entry so the next read re-loads the last good copy.
const dbCache = new Map<string, DB>();
// Stores with a write queued/in-flight are PINNED so LRU can't evict them — if a
// store were dropped mid-write, a concurrent read could reload the pre-write copy
// and a later write would clobber the unpersisted change (lost update).
const activeWrites = new Map<string, number>();
// Cap how many store documents sit in RAM at once, so a 100-store instance
// running 24/7 can't OOM by holding every store forever (the old cache never
// evicted). The LEAST-recently-used UNPINNED store is dropped and simply reloads
// from storage on its next use. Override with DB_CACHE_MAX.
const DB_CACHE_MAX = Math.max(4, Number(process.env.DB_CACHE_MAX) || 24);

function touchCache(sid: string, db: DB): void {
  // Re-insert to move this store to the newest position (Map keeps insertion
  // order), then evict the oldest UNPINNED stores until back under the cap.
  dbCache.delete(sid);
  dbCache.set(sid, db);
  if (dbCache.size <= DB_CACHE_MAX) return;
  for (const key of dbCache.keys()) {
    if (dbCache.size <= DB_CACHE_MAX) break;
    if (key === sid || activeWrites.get(key)) continue;
    dbCache.delete(key);
  }
}

async function loadDB(sid: string): Promise<DB> {
  const cached = dbCache.get(sid);
  if (cached) {
    touchCache(sid, cached);
    return cached;
  }
  const raw = await readBlob("store", sid);
  const db = raw == null ? await seedStore(sid) : backfill(JSON.parse(raw) as DB);
  touchCache(sid, db);
  return db;
}

/** Drop a store's cached copy (e.g. after an out-of-band change). */
export function invalidateDB(storeId: string): void {
  dbCache.delete(storeId);
}

export async function readDB(storeId?: string): Promise<DB> {
  const sid = await currentStoreId(storeId);
  return loadDB(sid);
}

export async function mutateDB<T>(
  mutator: (db: DB) => T | Promise<T>,
  storeId?: string,
): Promise<T> {
  const sid = await currentStoreId(storeId); // captured in request scope
  const run = async (): Promise<T> => {
    const db = await loadDB(sid);
    try {
      const result = await mutator(db);
      await writeBlob("store", sid, JSON.stringify(db));
      return result;
    } catch (e) {
      // The mutation may have partly changed the cached object without being
      // persisted — drop it so the next read reloads the last saved state.
      dbCache.delete(sid);
      throw e;
    }
  };
  // Pin this store while its write is queued/in-flight so LRU can't evict it
  // (see activeWrites), then queue behind only THIS store's previous write (not a
  // global chain) so other stores proceed in parallel.
  activeWrites.set(sid, (activeWrites.get(sid) ?? 0) + 1);
  const prev = writeChains.get(sid) ?? Promise.resolve();
  const next = prev.then(run, run);
  writeChains.set(sid, next.catch(() => undefined));
  return next.finally(() => {
    const n = (activeWrites.get(sid) ?? 1) - 1;
    if (n <= 0) activeWrites.delete(sid);
    else activeWrites.set(sid, n);
  });
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
