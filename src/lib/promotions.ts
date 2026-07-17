import type { Product, Promotion, PromotionScope, PromotionSettings, PromotionType } from "./types";
import { storeToday, storeTimeHHMM, withinDailyWindow } from "./storetime";

// ---------------------------------------------------------------------------
// The promotion engine
//
// The cashier scans; this decides. Nobody at the till applies a deal by hand,
// which means every rule in here has to hold with no human checking its work.
//
// Pure functions over data handed in — no database, no session, no HTTP. The
// till previews with the same code the server rings up with, so what the
// customer is quoted is what they get charged.
//
// Three rules run through all of it:
//
//   1. A unit is consumed at most once. Two deals can't both claim the same
//      bottle unless the owner has turned combining on — otherwise a basket
//      could discount past zero.
//   2. When deals compete, priority decides; on a tie, the customer wins.
//   3. The cheapest qualifying units are the ones consumed. This is the
//      conventional retail rule and, more importantly, a FIXED one — a deal
//      must ring up the same way twice for the same basket.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_PROMOTION_SETTINGS: PromotionSettings = {
  allowCombine: false,
  allowStackWithMarkdown: false,
};

export const PROMOTION_TYPE_LABEL: Record<PromotionType, string> = {
  BUY_X_GET_Y_FREE: "Buy X get Y free",
  BUY_X_AMOUNT_OFF: "Buy X, amount off",
  BUY_X_PERCENT_OFF: "Buy X, percent off",
  BUNDLE_PRICE: "Fixed bundle price",
};

/** A one-line plain description of the rule, for the till and the reports. */
export function describePromotion(p: Promotion): string {
  switch (p.type) {
    case "BUY_X_GET_Y_FREE":
      return `Buy ${p.buyQty} get ${p.freeQty ?? 0} free`;
    case "BUY_X_AMOUNT_OFF":
      return `Buy ${p.buyQty}, $${(p.discountAmount ?? 0).toFixed(2)} off`;
    case "BUY_X_PERCENT_OFF":
      return `Buy ${p.buyQty}, ${p.discountPercent ?? 0}% off`;
    case "BUNDLE_PRICE":
      return `Any ${p.buyQty} for $${(p.bundlePrice ?? 0).toFixed(2)}`;
  }
}

// --- Is it on right now? ---------------------------------------------------

/**
 * Whether a deal is live at this moment: switched on, inside its dates, and
 * inside its daily hours — all judged on the SHOP's clock, never the server's.
 *
 * Derived on every basket rather than stored as a flag, so a deal can't be left
 * running because a scheduled job didn't fire.
 */
export function isLive(p: Promotion, today = storeToday(), time = storeTimeHHMM()): boolean {
  if (p.status !== "Active") return false;
  if (today < p.startDate || today > p.endDate) return false; // endDate is the last day
  return withinDailyWindow(time, p.startTime, p.endTime);
}

export type PromotionState = "Live" | "Scheduled" | "Ended" | "Paused" | "Outside hours";

/** Why a deal is or isn't firing — the thing the promotions list has to show. */
export function promotionState(p: Promotion, today = storeToday(), time = storeTimeHHMM()): PromotionState {
  if (p.status === "Paused") return "Paused";
  if (today < p.startDate) return "Scheduled";
  if (today > p.endDate) return "Ended";
  if (!withinDailyWindow(time, p.startTime, p.endTime)) return "Outside hours";
  return "Live";
}

// --- Does it cover this product? -------------------------------------------

export function scopeMatches(scope: PromotionScope, product: Product): boolean {
  switch (scope.kind) {
    case "products":
      return scope.productIds.includes(product.id);
    case "category":
      return scope.categories.includes(product.category);
    case "supplier":
      return !!product.supplierCode && scope.supplierCodes.includes(product.supplierCode);
  }
}

/** How many products a deal covers — what the editor shows before you save it. */
export function scopeSize(scope: PromotionScope, products: Product[]): number {
  return products.filter((p) => scopeMatches(scope, p)).length;
}

export function describeScope(scope: PromotionScope): string {
  switch (scope.kind) {
    case "products":
      return scope.productIds.length === 1 ? "1 product" : `${scope.productIds.length} products`;
    case "category":
      return scope.categories.join(", ") || "no category";
    case "supplier":
      return scope.supplierCodes.join(", ") || "no supplier";
  }
}

// --- Working out a basket --------------------------------------------------

/** One line as it sits in the basket. `unitPrice` is what this line actually sells at. */
export type BasketLine = {
  productId: string;
  qty: number;
  unitPrice: number;
  /** Set when the line is being sold on a markdown label — already reduced. */
  markdownCode?: string;
};

export type PromotionApplication = {
  promotionId: string;
  code: string;
  name: string;
  type: PromotionType;
  detail: string;
  discount: number; // USD off the basket
  freeQty: number; // items handed over unpaid
  qty: number; // qualifying units the deal consumed
  revenue: number; // what the customer still pays for those units
  items: { productId: string; qty: number; freeQty: number }[];
};

export type BasketResult = {
  applications: PromotionApplication[];
  discount: number; // total off
};

// Every individual unit in the basket, so a deal can consume 3 of the 5 bottles
// on a line. Working per-unit rather than per-line is what makes "any 3 drinks
// for $5" possible across different products.
type Unit = { productId: string; price: number; markdownCode?: string; taken: boolean };

function explode(lines: BasketLine[]): Unit[] {
  const units: Unit[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.qty; i++) {
      units.push({ productId: l.productId, price: l.unitPrice, markdownCode: l.markdownCode, taken: false });
    }
  }
  return units;
}

function summarise(used: Unit[], freeUnits: Unit[]): PromotionApplication["items"] {
  const map = new Map<string, { productId: string; qty: number; freeQty: number }>();
  for (const u of used) {
    const row = map.get(u.productId) || { productId: u.productId, qty: 0, freeQty: 0 };
    row.qty += 1;
    map.set(u.productId, row);
  }
  for (const u of freeUnits) {
    const row = map.get(u.productId);
    if (row) row.freeQty += 1;
  }
  return [...map.values()];
}

/**
 * What one deal does to whatever units are still available, or null if it
 * doesn't qualify. Doesn't mutate — the caller decides whether to keep it.
 */
function evaluate(
  promo: Promotion,
  units: Unit[],
  products: Map<string, Product>,
  settings: PromotionSettings,
): { application: PromotionApplication; consumed: Unit[] } | null {
  const eligible = units.filter((u) => {
    if (u.taken && !settings.allowCombine) return false;
    // A marked-down item is already reduced. Discounting it again is a second
    // bite at the same margin, so it takes an explicit decision to allow.
    if (u.markdownCode && !settings.allowStackWithMarkdown) return false;
    const product = products.get(u.productId);
    return product ? scopeMatches(promo.scope, product) : false;
  });

  const buyQty = Math.max(1, Math.floor(promo.buyQty));
  if (eligible.length < buyQty) return null;

  // Cheapest first — the fixed rule (see the header). Sorting a copy keeps the
  // basket's own order intact for everything else.
  const pool = [...eligible].sort((a, b) => a.price - b.price);

  let consumed: Unit[] = [];
  let freeUnits: Unit[] = [];
  let discount = 0;

  switch (promo.type) {
    case "BUY_X_GET_Y_FREE": {
      const freeQty = Math.max(0, Math.floor(promo.freeQty ?? 0));
      if (freeQty === 0) return null;
      // The customer must have the paid ones AND the free ones in the basket —
      // the free bottle is a bottle they scanned, not an extra we add. That's
      // why stock still moves by the full amount.
      const perSet = buyQty + freeQty;
      const sets = Math.floor(pool.length / perSet);
      if (sets === 0) return null;
      consumed = pool.slice(0, sets * perSet);
      // Give away the cheapest of what this deal consumed.
      freeUnits = consumed.slice(0, sets * freeQty);
      discount = freeUnits.reduce((s, u) => s + u.price, 0);
      break;
    }
    case "BUY_X_AMOUNT_OFF": {
      const amount = Math.max(0, promo.discountAmount ?? 0);
      if (amount === 0) return null;
      const sets = Math.floor(pool.length / buyQty);
      if (sets === 0) return null;
      consumed = pool.slice(0, sets * buyQty);
      // Never let a deal pay the customer: the discount can't exceed what the
      // qualifying items are worth.
      const worth = consumed.reduce((s, u) => s + u.price, 0);
      discount = Math.min(sets * amount, worth);
      break;
    }
    case "BUY_X_PERCENT_OFF": {
      const percent = Math.max(0, Math.min(100, promo.discountPercent ?? 0));
      if (percent === 0) return null;
      const sets = Math.floor(pool.length / buyQty);
      if (sets === 0) return null;
      consumed = pool.slice(0, sets * buyQty);
      discount = consumed.reduce((s, u) => s + u.price, 0) * (percent / 100);
      break;
    }
    case "BUNDLE_PRICE": {
      const bundle = Math.max(0, promo.bundlePrice ?? 0);
      const sets = Math.floor(pool.length / buyQty);
      if (sets === 0) return null;
      consumed = pool.slice(0, sets * buyQty);
      const worth = consumed.reduce((s, u) => s + u.price, 0);
      // A bundle that costs more than the items do is not a deal — skip it
      // rather than charge extra.
      discount = Math.max(0, worth - sets * bundle);
      if (discount === 0) return null;
      break;
    }
  }

  discount = round2(discount);
  if (discount <= 0) return null;

  const worth = round2(consumed.reduce((s, u) => s + u.price, 0));
  return {
    application: {
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      type: promo.type,
      detail: describePromotion(promo),
      discount,
      freeQty: freeUnits.length,
      qty: consumed.length,
      revenue: round2(worth - discount),
      items: summarise(consumed, freeUnits),
    },
    consumed,
  };
}

/**
 * Work out every deal that fires on this basket.
 *
 * Greedy by priority: the highest-priority deal that qualifies takes its units
 * first, then the next is offered whatever is left. Within one priority level,
 * whichever deal saves the customer more money goes first — that's the "best
 * customer benefit" tiebreak, and it's evaluated against the units actually
 * still available, not in the abstract.
 *
 * A greedy pass isn't guaranteed to find the mathematically optimal split of a
 * basket across overlapping deals. It's chosen deliberately: it's predictable,
 * it's explainable to a customer at the counter, and it always terminates —
 * properties that matter more at a till than squeezing out the last cent.
 */
export function applyPromotions(
  lines: BasketLine[],
  promotions: Promotion[],
  products: Product[],
  settings: PromotionSettings = DEFAULT_PROMOTION_SETTINGS,
  now: Date = new Date(),
): BasketResult {
  const today = storeToday(now);
  const time = storeTimeHHMM(now);
  const byId = new Map(products.map((p) => [p.id, p]));
  const units = explode(lines);

  const live = promotions.filter((p) => isLive(p, today, time));
  const applications: PromotionApplication[] = [];
  const remaining = [...live];

  while (remaining.length > 0) {
    // Only the current top priority band competes on customer benefit; a
    // priority-90 deal never loses to a priority-10 one that saves more.
    const topPriority = Math.max(...remaining.map((p) => p.priority));
    const band = remaining.filter((p) => p.priority === topPriority);

    let best: { promo: Promotion; result: NonNullable<ReturnType<typeof evaluate>> } | null = null;
    for (const promo of band) {
      const result = evaluate(promo, units, byId, settings);
      if (!result) continue;
      if (!best || result.application.discount > best.result.application.discount) {
        best = { promo, result };
      }
    }

    if (!best) {
      // Nothing in this band qualifies — drop the whole band and move down.
      for (const p of band) remaining.splice(remaining.indexOf(p), 1);
      continue;
    }

    applications.push(best.result.application);
    for (const u of best.result.consumed) u.taken = true;
    remaining.splice(remaining.indexOf(best.promo), 1);
  }

  return {
    applications,
    discount: round2(applications.reduce((s, a) => s + a.discount, 0)),
  };
}

// --- Validation ------------------------------------------------------------

export type PromotionInput = Omit<Promotion, "id" | "code" | "createdBy" | "createdAt" | "updatedBy" | "updatedAt">;
export type ValidationResult = { ok: true; value: PromotionInput } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: PromotionType[] = ["BUY_X_GET_Y_FREE", "BUY_X_AMOUNT_OFF", "BUY_X_PERCENT_OFF", "BUNDLE_PRICE"];

function parseScope(raw: unknown, products: Product[]): { ok: true; value: PromotionScope } | { ok: false; error: string } {
  const s = (raw || {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

  if (s.kind === "category") {
    const categories = list(s.categories);
    if (!categories.length) return { ok: false, error: "Pick at least one category." };
    return { ok: true, value: { kind: "category", categories } };
  }
  if (s.kind === "supplier") {
    const supplierCodes = list(s.supplierCodes);
    if (!supplierCodes.length) return { ok: false, error: "Pick at least one brand / supplier." };
    return { ok: true, value: { kind: "supplier", supplierCodes } };
  }
  const productIds = list(s.productIds);
  if (!productIds.length) return { ok: false, error: "Pick at least one product." };
  const known = new Set(products.map((p) => p.id));
  const missing = productIds.filter((id) => !known.has(id));
  if (missing.length) return { ok: false, error: "One of the products isn't in the catalogue any more." };
  return { ok: true, value: { kind: "products", productIds } };
}

/**
 * Check a promotion coming off the wire.
 *
 * The type decides which numbers matter, so each is validated on its own terms
 * rather than demanding every field for every type — a "buy 2 get 1 free" has
 * no percentage, and asking for one would be nonsense.
 */
/**
 * @param knownStoreIds every store that exists. A deal may name a subset to run
 *   in; anything not on this list is a store that's been removed or was never
 *   real, and silently keeping it would leave a deal aimed at nowhere.
 */
export function validatePromotionInput(
  body: unknown,
  products: Product[],
  knownStoreIds?: string[],
): ValidationResult {
  const b = (body || {}) as Record<string, unknown>;

  const name = String(b.name || "").trim();
  if (!name) return { ok: false, error: "A promotion name is required." };
  if (name.length > 120) return { ok: false, error: "That promotion name is too long." };

  const type = String(b.type || "") as PromotionType;
  if (!TYPES.includes(type)) return { ok: false, error: "Pick a promotion type." };

  const scope = parseScope(b.scope, products);
  if (!scope.ok) return { ok: false, error: scope.error };

  const buyQty = Math.floor(Number(b.buyQty));
  if (!Number.isFinite(buyQty) || buyQty < 1) return { ok: false, error: "The buy quantity must be at least 1." };

  let freeQty: number | undefined;
  let discountAmount: number | undefined;
  let discountPercent: number | undefined;
  let bundlePrice: number | undefined;

  if (type === "BUY_X_GET_Y_FREE") {
    freeQty = Math.floor(Number(b.freeQty));
    if (!Number.isFinite(freeQty) || freeQty < 1) return { ok: false, error: "How many items are free?" };
  } else if (type === "BUY_X_AMOUNT_OFF") {
    discountAmount = Number(b.discountAmount);
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
      return { ok: false, error: "How much comes off the price?" };
    }
    discountAmount = Math.round(discountAmount * 100) / 100;
  } else if (type === "BUY_X_PERCENT_OFF") {
    discountPercent = Number(b.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      return { ok: false, error: "The discount must be between 1 and 100%." };
    }
  } else {
    bundlePrice = Number(b.bundlePrice);
    if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) return { ok: false, error: "What does the bundle cost?" };
    bundlePrice = Math.round(bundlePrice * 100) / 100;
    if (buyQty < 2) return { ok: false, error: "A bundle needs at least 2 items." };
  }

  const startDate = String(b.startDate || "");
  const endDate = String(b.endDate || "");
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { ok: false, error: "Start and end dates are required." };
  }
  if (endDate < startDate) return { ok: false, error: "The end date can't be before the start date." };

  // A daily window is all-or-nothing: one end without the other has no meaning.
  const startTime = String(b.startTime || "").trim();
  const endTime = String(b.endTime || "").trim();
  if (!!startTime !== !!endTime) {
    return { ok: false, error: "Set both a start and an end time, or leave both blank for all day." };
  }
  if (startTime && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) {
    return { ok: false, error: "Times must look like 07:00 or 19:30." };
  }

  const priority = Math.floor(Number(b.priority));
  if (!Number.isFinite(priority) || priority < 1 || priority > 100) {
    return { ok: false, error: "Priority must be between 1 and 100." };
  }

  // Which shops run it. Absent = every store, which is also what a deal written
  // before stores could be picked has always meant.
  let storeIds: string[] | undefined;
  if (Array.isArray(b.storeIds)) {
    const picked = [...new Set(b.storeIds.map((x) => String(x)).filter(Boolean))];
    // An empty list is NOT "all stores". Widening a discount to the whole chain
    // because someone unticked the last shop is the one mistake here that costs
    // real money, so it's an error, not a default.
    if (!picked.length) return { ok: false, error: "Pick at least one store, or set the deal to run in every store." };
    const unknown = knownStoreIds ? picked.filter((id) => !knownStoreIds.includes(id)) : [];
    if (unknown.length) return { ok: false, error: `No such store: ${unknown.join(", ")}.` };
    // Naming every store IS every store — stored as `undefined` so the deal
    // still covers a shop opened next month, rather than quietly missing it.
    const all = knownStoreIds ? knownStoreIds.every((id) => picked.includes(id)) : false;
    storeIds = all ? undefined : picked;
  }

  return {
    ok: true,
    value: {
      storeIds,
      name,
      type,
      scope: scope.value,
      buyQty,
      freeQty,
      discountAmount,
      discountPercent,
      bundlePrice,
      startDate,
      endDate,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      status: b.status === "Paused" ? "Paused" : "Active",
      priority,
    },
  };
}
