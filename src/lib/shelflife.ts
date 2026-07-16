import type { Product } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shelf life & replenishment policy
//
// Short-shelf-life goods (RTE food, fresh dairy, made-to-order drinks) must be
// ordered in small, frequent lots — never bulk — or they spoil. This module
// gives every product an effective shelf life and turns that, together with its
// ABC class, into a target days-of-cover the Purchase Request screen uses to
// suggest a shelf-life-capped order quantity.
//
// Defaults below cover the categories where shelf life actually matters
// (perishable / chilled / frozen). Ambient goods (snacks, canned, long-life
// drinks, non-food) are intentionally omitted → they return null → no cap,
// which is correct: ordering 30 days of biscuits is fine. A product's OWN
// shelfLifeDays (from the master) always wins over these defaults, and a store
// can override any category (see effectiveShelfLifeDays `overrides`).
// ---------------------------------------------------------------------------

export const CATEGORY_SHELF_LIFE_DAYS: Record<string, number> = {
  // Fresh prepared food (RTE Food) — 1–10 days
  "Cold Sandwich": 2,
  "Toast Sandwich": 2,
  "Other-Sandwich Bread": 10,
  "Fresh Baked": 2,
  CookedFood: 2,
  "Cooked Food": 2,
  "Fast Food": 3,
  Salad: 3,
  Fried: 2,
  Appetizer: 7,
  Eggs: 21,
  Dumplings: 3,
  "Dumplings/ Surimi": 3,
  "Dim Sum": 3,
  "Chinese Bun": 2,
  "Fried Rice": 3,
  "Noodle / Spaghetti": 3,
  Noodles: 3,
  "Spicy Noodle": 3,
  "Porridge & Soup": 3,
  "Boiled Rice / Porridge": 7,
  "Steamed Rice and Side Dishes": 3,
  "Steamed Rice+Side Dishes": 3,
  "Rice Ball and Sushi": 2,
  "Rice Box": 2,
  "Bun Burger": 10,
  "Sticky Rice Burger": 10,
  "Chilled Cake": 5,
  Dessert: 7,
  Fruit: 7,
  Meatball: 2,
  Sausage: 14,
  "Grilled Sausage": 3,
  "Bologna/ Slices Type": 14,
  "Sausage and Bread": 5,
  // Fresh / chilled dairy
  "Pasteurized Fresh Milk": 7,
  "Drinking Yogurt": 30,
  "Drinking Yogurt 2": 21,
  Yogurt: 30,
  // Made-to-order drinks — the finished drink isn't stocked, so keep it tight
  Slush: 1,
  Slushe: 1,
  "Coca Machine": 1,
  "Hot Drink": 1,
  "Jet Spray": 1,
  "ON Cafe": 1,
  // Frozen
  "Frozen Appetizers": 90,
  "Frozen Fruit sand Vegetables": 90,
  "Frozen Fruits and Vegetables": 90,
};

// Fallback for any category not explicitly mapped above.
function classifyByKeyword(category: string): number | null {
  const c = category.toLowerCase();
  if (/\bfrozen\b/.test(c)) return 90;
  if (/yogurt|yoghurt/.test(c)) return 30;
  if (/pasteuri|fresh milk/.test(c)) return 7;
  if (/\bfresh\b|chilled/.test(c)) return 7;
  return null; // ambient / unknown → no shelf-life cap
}

// The built-in default shelf life for a category (null = ambient / no cap).
export function defaultShelfLifeDays(category: string): number | null {
  if (Object.prototype.hasOwnProperty.call(CATEGORY_SHELF_LIFE_DAYS, category)) {
    return CATEGORY_SHELF_LIFE_DAYS[category];
  }
  return classifyByKeyword(category);
}

// Effective shelf life for a product: its own master value wins, then a
// store-set per-category override, then the built-in default. null = ambient.
export function effectiveShelfLifeDays(
  p: Pick<Product, "shelfLifeDays" | "category">,
  overrides?: Record<string, number>,
): number | null {
  if (p.shelfLifeDays != null && p.shelfLifeDays > 0) return p.shelfLifeDays;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, p.category)) {
    return overrides[p.category];
  }
  return defaultShelfLifeDays(p.category);
}

export type ShelfClass = "short" | "chilled" | "ambient";

// Bucket a shelf life into a class the UI can flag and the order logic can act on.
export function shelfClass(days: number | null): ShelfClass {
  if (days == null) return "ambient";
  if (days <= 14) return "short";
  if (days <= 90) return "chilled";
  return "ambient";
}

export type AbcClass = "A" | "B" | "C";

// Target days-of-cover for a replenishment suggestion, by ABC class and
// perishability:
//   • Ambient goods → the buyer's chosen cover window (they hold fine).
//   • Perishable/chilled → tight ABC-based cover, never above ~80% of shelf
//     life, so it always sells before it expires.
export function targetCoverDays(
  abc: AbcClass | undefined,
  shelfDays: number | null,
  ambientCover: number,
): number {
  const cls = shelfClass(shelfDays);
  if (cls === "ambient") return Math.max(1, ambientCover);
  const a = abc ?? "B";
  const base = cls === "short" ? { A: 2, B: 3, C: 4 }[a] : { A: 4, B: 7, C: 10 }[a];
  const cap = Math.max(1, Math.floor((shelfDays as number) * 0.8));
  return Math.min(base, cap);
}

// The shelf-life-capped recommended order quantity.
//   rate = average units sold per day (30-day, falling back to 7-day)
//   cover = targetCoverDays(...)
// Returns the number of units to order to reach `rate × cover` on hand. Can be
// ≤ 0 when already overstocked for a perishable — the caller decides how to
// present that (e.g. an "overstock" flag) vs. forcing a minimum of 1 on add.
export function recommendedOrderQty(args: {
  ratePerDay: number;
  onHand: number;
  cover: number;
  reorderLevel: number;
}): number {
  const { ratePerDay, onHand, cover, reorderLevel } = args;
  if (ratePerDay > 0) return Math.ceil(ratePerDay * cover) - onHand;
  // No recent sales → fall back to the reorder-level gap.
  if (reorderLevel > 0) return reorderLevel * 2 - onHand;
  return 1 - onHand > 0 ? 1 - onHand : 1;
}
