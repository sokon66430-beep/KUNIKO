import type { Product, Recipe, RecipeItem } from "./types";
import { convert, conversionProblem, formatQty, normalizeUnit } from "./units";
import { gpPercent, VAT_RATE } from "./format";

// ---------------------------------------------------------------------------
// The Recipe service
//
// Everything here is a pure function over data it is handed — no database, no
// session, no HTTP. The sales route and the recipe pages both call in; neither
// owns the rules. That keeps the recipe logic testable on its own and means a
// future batch-production feature can reuse `consumptionPlan` unchanged.
//
// Two rules run through all of it:
//
//   1. An ingredient is just an ordinary Product. Nothing about stock, cost or
//      purchasing needs a special case for "ingredient" — a recipe only names
//      products and quantities.
//   2. A recipe never blocks a sale. If an ingredient is missing, or its unit
//      can't be converted, we report the problem and carry on. A cook cannot
//      un-serve a bowl of noodles because the data was wrong.
// ---------------------------------------------------------------------------

/** The unit a product's stock is counted in. Falls back to pieces. */
export function stockUnitOf(p: Pick<Product, "unit">): string {
  return normalizeUnit(p.unit) || "pcs";
}

// --- Costing ---------------------------------------------------------------

export type CostLine = {
  item: RecipeItem;
  product?: Product;
  /** The recipe quantity expressed in the product's own stock unit (0.08 kg). */
  qtyInStockUnit: number | null;
  /** Cost of this line, or null when it can't be worked out. */
  cost: number | null;
  /** Why this line has no cost, phrased for the person who must fix it. */
  problem?: string;
};

export type RecipeCosting = {
  lines: CostLine[];
  /** Total of the lines we could cost. */
  total: number;
  /** Lines we couldn't cost — the total understates the truth by this many. */
  unresolved: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * What one batch of this recipe costs, from the live cost of each ingredient.
 * Cost is never stored on the recipe: ingredient costs move every delivery, and
 * a stored number would quietly go stale and misreport margin.
 */
export function recipeCosting(recipe: Pick<Recipe, "items">, products: Product[]): RecipeCosting {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: CostLine[] = recipe.items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) {
      return { item, qtyInStockUnit: null, cost: null, problem: "this ingredient no longer exists in Products" };
    }
    const stockUnit = stockUnitOf(product);
    const sizes = { packSize: product.packSize, boxSize: product.boxSize };
    const qty = convert(item.quantity, item.unit, stockUnit, sizes);
    if (qty == null) {
      return {
        item,
        product,
        qtyInStockUnit: null,
        cost: null,
        problem: conversionProblem(item.unit, stockUnit, sizes) || "can't convert this unit",
      };
    }
    return { item, product, qtyInStockUnit: qty, cost: round4(qty * (product.cost || 0)) };
  });

  const total = round4(lines.reduce((s, l) => s + (l.cost ?? 0), 0));
  const unresolved = lines.filter((l) => l.cost == null).length;
  return { lines, total, unresolved };
}

export type RecipeEconomics = {
  cost: number; // food cost of one batch
  price: number; // VAT-inclusive sell price of the linked product
  netPrice: number; // price with the embedded VAT stripped out
  profit: number; // gross profit per sale
  margin: number; // gross profit as % of the net price
  foodCostPct: number; // food cost as % of the net price
};

/**
 * Food cost vs selling price. Sell prices here are VAT-INCLUSIVE (see
 * lib/format), so profit and margin are measured against the ex-VAT price —
 * the same basis as every other margin in the app. Measuring against the
 * sticker price instead would overstate every recipe's margin.
 */
export function recipeEconomics(cost: number, price: number, vatRate = VAT_RATE): RecipeEconomics {
  const netPrice = round4((price || 0) / (1 + vatRate));
  const profit = round4(netPrice - (cost || 0));
  return {
    cost: round4(cost || 0),
    price: round2(price || 0),
    netPrice,
    profit,
    margin: gpPercent(cost || 0, price || 0, vatRate),
    foodCostPct: netPrice > 0 ? ((cost || 0) / netPrice) * 100 : 0,
  };
}

// --- Consumption -----------------------------------------------------------

export type Deduction = {
  productId: string;
  sku: string;
  name: string;
  qtyUsed: number; // as the recipe writes it, scaled by the sale (400)
  unit: string; // …in this unit (g)
  qtyDeducted: number; // what leaves stock (0.4)
  stockUnit: string; // …in the product's unit (kg)
  cost: number; // value consumed
};

export type PlanProblem = {
  productId?: string;
  name: string;
  message: string;
};

export type ConsumptionPlan = {
  deductions: Deduction[];
  /** Lines that could NOT be deducted. The sale still goes through. */
  problems: PlanProblem[];
};

/**
 * What selling `multiplier` of this recipe takes out of stock.
 *
 * Returns a plan rather than applying it: the caller applies it inside its own
 * write transaction, so the deduction and the sale land together or not at all.
 * Nothing here throws — a bad ingredient becomes a problem in the list, never
 * an exception that would fail the sale.
 */
export function consumptionPlan(recipe: Recipe, products: Product[], multiplier = 1): ConsumptionPlan {
  const byId = new Map(products.map((p) => [p.id, p]));
  const deductions: Deduction[] = [];
  const problems: PlanProblem[] = [];
  const times = Math.max(0, multiplier);

  for (const item of recipe.items) {
    const product = byId.get(item.productId);
    if (!product) {
      problems.push({
        productId: item.productId,
        name: item.name,
        message: `${item.name} is no longer in Products — stock was not deducted`,
      });
      continue;
    }
    const stockUnit = stockUnitOf(product);
    const sizes = { packSize: product.packSize, boxSize: product.boxSize };
    const qtyUsed = round4(item.quantity * times);
    const qtyDeducted = convert(qtyUsed, item.unit, stockUnit, sizes);
    if (qtyDeducted == null) {
      problems.push({
        productId: product.id,
        name: product.name,
        message: `${product.name}: ${conversionProblem(item.unit, stockUnit, sizes)} — stock was not deducted`,
      });
      continue;
    }
    deductions.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      qtyUsed,
      unit: normalizeUnit(item.unit) || item.unit,
      qtyDeducted,
      stockUnit,
      cost: round4(qtyDeducted * (product.cost || 0)),
    });
  }

  return { deductions, problems };
}

/** The recipe a sellable product is made from, if it's linked and still active. */
export function recipeFor(product: Pick<Product, "recipeId">, recipes: Recipe[]): Recipe | undefined {
  if (!product.recipeId) return undefined;
  const r = recipes.find((x) => x.id === product.recipeId);
  // An Inactive recipe stays on file for reference but stops deducting — the
  // way to pause a recipe without losing what it was.
  return r && r.status === "Active" ? r : undefined;
}

// --- Ingredient view of the catalog ----------------------------------------

/** Every product used by at least one recipe, and which recipes use it. */
export function ingredientUsage(recipes: Recipe[]): Map<string, Recipe[]> {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) {
    for (const item of r.items) {
      const list = map.get(item.productId);
      if (list) {
        if (!list.some((x) => x.id === r.id)) list.push(r);
      } else {
        map.set(item.productId, [r]);
      }
    }
  }
  return map;
}

export type AlertLevel = "negative" | "low";

export type IngredientAlert = {
  product: Product;
  level: AlertLevel;
  usedBy: string[]; // recipe names
};

/**
 * Ingredients that need attention. Derived from live stock every time it's
 * asked for — never a stored flag, so it can't be left switched on after
 * someone restocks.
 */
export function ingredientAlerts(recipes: Recipe[], products: Product[]): IngredientAlert[] {
  const usage = ingredientUsage(recipes.filter((r) => r.status === "Active"));
  const alerts: IngredientAlert[] = [];
  for (const p of products) {
    const used = usage.get(p.id);
    if (!used) continue;
    const level: AlertLevel | null =
      p.stock < 0 ? "negative" : p.stock <= (p.reorderLevel || 0) ? "low" : null;
    if (!level) continue;
    alerts.push({ product: p, level, usedBy: used.map((r) => r.name) });
  }
  // Negative first (already sold what we don't have), then closest to zero.
  return alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === "negative" ? -1 : 1;
    return a.product.stock - b.product.stock;
  });
}

// --- Validation ------------------------------------------------------------

export type RecipeInput = {
  name: string;
  nameKh?: string;
  description?: string;
  image?: string;
  status: "Active" | "Inactive";
  items: RecipeItem[];
};

export type ValidationResult = { ok: true; value: RecipeInput } | { ok: false; error: string };

export const MAX_RECIPE_ITEMS = 100;

/**
 * Check a recipe coming off the wire and resolve it against the catalog.
 *
 * Unit compatibility is enforced HERE, at save time, rather than at the till:
 * an unconvertible line would otherwise save happily and then silently fail to
 * deduct on every sale, and nobody would notice until stock was badly wrong.
 * Failing now puts the error in front of the person who can fix it.
 */
export function validateRecipeInput(body: unknown, products: Product[]): ValidationResult {
  const b = (body || {}) as Record<string, unknown>;
  const name = String(b.name || "").trim();
  if (!name) return { ok: false, error: "A recipe name is required." };
  if (name.length > 120) return { ok: false, error: "That recipe name is too long." };

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) return { ok: false, error: "Add at least one ingredient." };
  if (rawItems.length > MAX_RECIPE_ITEMS) {
    return { ok: false, error: `A recipe can hold up to ${MAX_RECIPE_ITEMS} ingredients.` };
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const items: RecipeItem[] = [];

  for (const raw of rawItems as Record<string, unknown>[]) {
    const product = byId.get(String(raw.productId || ""));
    if (!product) return { ok: false, error: "One of the ingredients isn't in Products any more." };
    if (seen.has(product.id)) {
      return { ok: false, error: `${product.name} is listed twice — put the whole amount on one line.` };
    }
    seen.add(product.id);

    const quantity = Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `How much ${product.name} does the recipe use?` };
    }

    const unit = normalizeUnit(String(raw.unit || ""));
    if (!unit) return { ok: false, error: `Pick a unit for ${product.name}.` };

    const stockUnit = stockUnitOf(product);
    const problem = conversionProblem(unit, stockUnit, {
      packSize: product.packSize,
      boxSize: product.boxSize,
    });
    if (problem) {
      return {
        ok: false,
        error: `${product.name}: ${problem}. Stock is counted in ${stockUnit} — fix the product's unit, or write this line in ${stockUnit}.`,
      };
    }

    items.push({
      productId: product.id,
      // sku/name are a display copy — always taken from the catalog, never from
      // the client, so a renamed product can't be misrepresented in a recipe.
      sku: product.sku,
      name: product.name,
      quantity: round4(quantity),
      unit,
    });
  }

  const status = b.status === "Inactive" ? "Inactive" : "Active";
  return {
    ok: true,
    value: {
      name,
      nameKh: String(b.nameKh || "").trim() || undefined,
      description: String(b.description || "").trim() || undefined,
      image: String(b.image || "").trim() || undefined,
      status,
      items,
    },
  };
}

/** "150 g", "0.08 kg" — re-exported so pages don't reach into lib/units. */
export { formatQty };
