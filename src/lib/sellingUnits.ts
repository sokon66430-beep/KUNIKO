import type { Product, SellingUnit } from "./types";
import { matchesBarcode } from "./barcodes";
import { packagingItemId } from "./itemId";

// ---------------------------------------------------------------------------
// Selling units — one product, several packagings, ONE stock balance
//
// A can, a 6-pack and a case are the same Coca Cola. Making them three products
// would give the shelf three stock counts that immediately disagree, so instead
// a product carries extra SELLING levels, and stock is always counted in the
// smallest one.
//
// The base level is not stored here. It IS the product: `product.unit` names it,
// `product.price` prices it, `product.barcode` scans it, and `product.stock`
// counts in it. Everything already in the app — markdowns, promotions, recipes,
// price labels, GP — reads those fields, so duplicating the base level into a
// SellingUnit row would create a second source of truth for the price and let
// the two drift. `sellingUnits` therefore holds only the levels ABOVE the base
// (conversion > 1).
//
// The conversion rule the whole feature rests on: a quantity in the system is
// ALWAYS in base units. A selling unit only decides how a scan is priced and how
// many base units one scan is worth.
// ---------------------------------------------------------------------------

/** A packaging level, with the base flattened in so callers see one list. */
export type ResolvedUnit = {
  id: string; // "base" for the product's own level
  name: string; // "Unit", "Pack", "Case"
  conversion: number; // base units in one of these
  price: number; // USD for one of these
  barcode?: string;
  isBase: boolean;
  isDefault: boolean;
  active: boolean;
};

// The catalogue's unit column is "U" for nearly every product, which is a code,
// not a word a cashier would recognise on a screen.
export function baseUnitName(product: Pick<Product, "unit">): string {
  const u = (product.unit || "").trim();
  if (!u || u.toUpperCase() === "U") return "Unit";
  return u;
}

/**
 * Every way this product can be sold, base first, then bigger packs.
 * Inactive levels are included — the caller decides whether to offer them, and
 * a sale already rung up on one still has to resolve.
 */
export function unitsOf(product: Product): ResolvedUnit[] {
  const extras = (product.sellingUnits || [])
    .map((u) => ({
      id: u.id,
      name: u.name,
      conversion: u.conversion,
      price: u.price,
      barcode: u.barcode,
      isBase: false,
      isDefault: !!u.isDefault,
      active: u.active !== false,
    }))
    .sort((a, b) => a.conversion - b.conversion);

  const anotherIsDefault = extras.some((u) => u.isDefault && u.active);
  const base: ResolvedUnit = {
    id: "base",
    name: baseUnitName(product),
    conversion: 1,
    price: product.price,
    barcode: product.barcode,
    isBase: true,
    isDefault: !anotherIsDefault,
    active: true, // the base level can't be switched off — it's the product
  };
  return [base, ...extras];
}

/** Only the levels a cashier may actually sell right now. */
export function sellableUnits(product: Product): ResolvedUnit[] {
  return unitsOf(product).filter((u) => u.active);
}

/** What tapping the product on the till sells, when nothing was scanned. */
export function defaultUnitOf(product: Product): ResolvedUnit {
  const units = sellableUnits(product);
  return units.find((u) => u.isDefault) || units[0];
}

export function unitById(product: Product, unitId: string | undefined): ResolvedUnit | undefined {
  if (!unitId) return undefined;
  return unitsOf(product).find((u) => u.id === unitId);
}

/** Does this product sell in anything bigger than its base unit? */
export function hasPackaging(product: Product): boolean {
  return (product.sellingUnits || []).length > 0;
}

// --- Scanning --------------------------------------------------------------

export type BarcodeHit = { product: Product; unit: ResolvedUnit };

/**
 * Resolve a scanned barcode to a product AND the packaging it was on.
 *
 * Pack/case barcodes are checked BEFORE base barcodes: they're the more
 * specific claim, and a base barcode that happens to equal a case barcode
 * should ring up the case the cashier physically scanned.
 */
export function findByBarcode(products: Product[], code: string): BarcodeHit | undefined {
  const q = code.trim();
  if (!q) return undefined;

  for (const product of products) {
    for (const u of product.sellingUnits || []) {
      // Its own barcode OR its own product code — either one identifies this
      // exact packaging, so scanning/typing the code sells that level.
      if (u.active !== false && ((u.barcode && u.barcode === q) || (u.sku && u.sku === q))) {
        const unit = unitById(product, u.id);
        if (unit) return { product, unit };
      }
    }
  }
  for (const product of products) {
    // Any of the product's codes, not just the primary — see lib/barcodes.
    if (matchesBarcode(product, q) || product.sku.toLowerCase() === q.toLowerCase()) {
      return { product, unit: unitsOf(product)[0] };
    }
  }
  return undefined;
}

/**
 * The effective per-unit BUY cost, honouring case pricing.
 *
 * A case usually costs less than 24× a single, so once a packaging level carries
 * its own buy cost the REAL per-unit cost is that case cost split across the
 * units in it. The biggest packaging with a cost set wins — buying by the case
 * is the cheapest, and that's the price the shop actually pays. Falls back to the
 * product's own `cost` when no packaging cost is set, so nothing changes for a
 * product until a case price is actually entered.
 *
 * Used everywhere purchasing books a cost — purchase requests, POs, receiving and
 * the stock value that flows from them — so all four agree.
 */
export function purchaseUnitCost(product: Pick<Product, "cost" | "sellingUnits">): number {
  const levels = (product.sellingUnits || []).filter((u) => (u.cost ?? 0) > 0 && u.conversion > 1);
  if (!levels.length) return product.cost || 0;
  const biggest = levels.reduce((a, b) => (b.conversion > a.conversion ? b : a));
  // Keep extra precision here; callers round the line total to cents so a full
  // case (e.g. $10.00 / 24 × 24) lands back exactly on the case price.
  return Math.round((biggest.cost! / biggest.conversion) * 1e6) / 1e6;
}

/**
 * Type-ahead search over a product's PACKAGING levels.
 *
 * The base unit is found by product name / Item ID / barcode elsewhere; this
 * adds the packs, so typing part of a case's barcode or its product code finds
 * the product too. Without it a pack a shop set up was invisible in the till's
 * search box — it could only be rung up by scanning the exact code.
 */
export function packagingMatches(product: Product, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return false;
  return (product.sellingUnits || []).some(
    (u) => (u.barcode || "").toLowerCase().includes(q) || (u.sku || "").toLowerCase().includes(q),
  );
}

// --- Stock display ---------------------------------------------------------

export type StockPart = { name: string; count: number };

/**
 * Break a base-unit balance into the biggest packagings that fit:
 * 452 units with Case=24, Pack=6 → 18 Cases, 3 Packs, 2 Units.
 *
 * Presentation only — the balance itself never stops being 452.
 */
export function breakdown(baseQty: number, units: ResolvedUnit[]): StockPart[] {
  // A negative balance (sold past what we had) has no sensible packaging
  // breakdown — the caller shows the raw figure instead of pretending.
  if (baseQty <= 0) return [];
  const levels = [...units].sort((a, b) => b.conversion - a.conversion);
  const parts: StockPart[] = [];
  let left = Math.floor(baseQty);
  for (const level of levels) {
    if (level.conversion <= 0) continue;
    const count = Math.floor(left / level.conversion);
    if (count > 0) {
      parts.push({ name: count === 1 ? level.name : plural(level.name), count });
      left -= count * level.conversion;
    }
  }
  return parts;
}

function plural(name: string): string {
  if (/(s|x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

/** "18 Cases, 3 Packs, 2 Units" — or "" when there's nothing worth splitting. */
export function describeBreakdown(baseQty: number, units: ResolvedUnit[]): string {
  const parts = breakdown(baseQty, units);
  if (parts.length <= 1) return ""; // "452 Units" adds nothing to "452"
  return parts.map((p) => `${p.count} ${p.name}`).join(", ");
}

/** How many base units this many of that packaging is worth. */
export function toBaseQty(unit: Pick<ResolvedUnit, "conversion">, unitQty: number): number {
  return Math.max(0, Math.floor(unitQty)) * Math.max(1, Math.floor(unit.conversion));
}

// --- Recipes ---------------------------------------------------------------

/**
 * The pack/box sizes lib/units.ts needs to convert a recipe line written in
 * packs. Sourced from the selling units when they exist so a "Pack" can't mean
 * 6 at the till and 10 in a recipe; the older packSize/boxSize fields stay as
 * the fallback for products that never got selling units.
 */
export function packSizesOf(product: Product): { packSize?: number; boxSize?: number } {
  const named = (want: string) =>
    (product.sellingUnits || []).find((u) => u.name.trim().toLowerCase() === want && u.active !== false)?.conversion;
  return {
    packSize: named("pack") ?? product.packSize,
    boxSize: named("box") ?? named("case") ?? named("carton") ?? product.boxSize,
  };
}

// --- Validation ------------------------------------------------------------

export type ValidationResult = { ok: true; value: SellingUnit[] } | { ok: false; error: string };

export const MAX_SELLING_UNITS = 8;

/**
 * Check a set of selling units for one product.
 *
 * Barcodes are the strict part: a scan has to resolve to exactly one thing, so
 * a new packaging barcode may not collide with any other product's barcode or
 * any other packaging's. (The imported master already contains ~123 products
 * sharing barcodes with each other — that's pre-existing data we don't touch
 * here, but we refuse to add to it.)
 */
export function validateSellingUnits(
  raw: unknown,
  productId: string,
  allProducts: Product[],
  baseSku?: string,
): ValidationResult {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_SELLING_UNITS) {
    return { ok: false, error: `A product can have up to ${MAX_SELLING_UNITS} packaging levels.` };
  }

  const value: SellingUnit[] = [];
  const seenNames = new Set<string>();
  const seenConversions = new Set<number>();

  // Every product code already in use, so a packaging level's own code can be
  // made unique against all of them: the base products' Item IDs AND every other
  // packaging code. This product's OWN current packaging codes are left out —
  // they're being replaced by the set we're validating now, and any that carry
  // over keep their code below (a stable code that doesn't reshuffle on edits).
  const takenCodes = new Set<string>();
  for (const p of allProducts) {
    if (p.sku) takenCodes.add(p.sku);
    for (const u of p.sellingUnits || []) {
      if (u.sku && p.id !== productId) takenCodes.add(u.sku);
    }
  }
  // Prefix comes from the base product's own code; fall back to the stored one.
  const prefixSku = (baseSku && baseSku.trim()) || allProducts.find((p) => p.id === productId)?.sku || "";

  for (const rawUnit of list as Record<string, unknown>[]) {
    const name = String(rawUnit.name || "").trim();
    if (!name) return { ok: false, error: "Every packaging level needs a name." };
    if (name.length > 24) return { ok: false, error: `"${name}" is too long for a unit name.` };
    if (seenNames.has(name.toLowerCase())) {
      return { ok: false, error: `There are two levels called "${name}".` };
    }
    seenNames.add(name.toLowerCase());

    const conversion = Math.floor(Number(rawUnit.conversion));
    if (!Number.isFinite(conversion) || conversion < 2) {
      // 1 would be a second name for the base unit, with its own price — the
      // exact duplicate-stock-and-price problem this design exists to avoid.
      return { ok: false, error: `How many units are in one ${name}? It must be 2 or more.` };
    }
    if (seenConversions.has(conversion)) {
      return { ok: false, error: `Two levels both hold ${conversion} units — give them different sizes.` };
    }
    seenConversions.add(conversion);

    const price = Number(rawUnit.price);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: `What does one ${name} sell for?` };

    // Buy cost is optional (a case may cost less than 24× a single). Never negative.
    const costNum = Number(rawUnit.cost);
    const cost = Number.isFinite(costNum) && costNum > 0 ? Math.round(costNum * 100) / 100 : undefined;

    const barcode = String(rawUnit.barcode || "").trim();
    if (barcode) {
      const clash = allProducts.find(
        (p) =>
          (p.id !== productId && p.barcode === barcode) ||
          (p.sellingUnits || []).some((u) => u.barcode === barcode && !(p.id === productId && u.name.trim().toLowerCase() === name.toLowerCase())),
      );
      if (clash) {
        return { ok: false, error: `Barcode ${barcode} is already used by ${clash.name}.` };
      }
    }

    // Its own product code. Keep a carried-over one if it's a real 8-digit code
    // that hasn't collided with anything, so editing a product never reshuffles
    // codes; otherwise the system mints a fresh unique one (base's first 4 digits
    // + a running tail). Reserve it so two new levels can't land on the same code.
    const givenSku = String(rawUnit.sku || "").trim();
    const sku =
      /^\d{8}$/.test(givenSku) && !takenCodes.has(givenSku)
        ? givenSku
        : packagingItemId(prefixSku, takenCodes);
    takenCodes.add(sku);

    value.push({
      id: String(rawUnit.id || "").trim() || `su_${name.toLowerCase().replace(/\W+/g, "")}_${conversion}`,
      name,
      sku,
      conversion,
      price: Math.round(price * 100) / 100,
      cost,
      barcode: barcode || undefined,
      isDefault: !!rawUnit.isDefault,
      active: rawUnit.active !== false,
    });
  }

  // The base level is the fallback default, so at most one pack may claim it.
  const defaults = value.filter((u) => u.isDefault);
  if (defaults.length > 1) {
    return { ok: false, error: "Only one packaging level can be the default." };
  }

  return { ok: true, value: value.sort((a, b) => a.conversion - b.conversion) };
}
