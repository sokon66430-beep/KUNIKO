import type { Product } from "./types";

// ---------------------------------------------------------------------------
// What shows on the POS screen
//
// Most products are sold by SCANNING their barcode, so they never need to be on
// screen. A minority are sold directly at the till (fresh food, made-to-order
// drinks) and the cashier taps them.
//
// Each product carries its own `showOnPos` flag, set per item in Master Data.
// Until it's set, we fall back to these categories — the ones ON Mart actually
// sells over the counter — so the till is useful with no data entry, and the
// owner can override any single product either way.
// ---------------------------------------------------------------------------

export const DEFAULT_POS_CATEGORIES: string[] = [
  "Chinese Bun",
  "Dumplings",
  "Fresh Baked",
  "Fried Rice",
  "Ice",
  "Jet Spray",
  "Noodle / Spaghetti",
  "ON Cafe",
  "Slush",
  "Spicy Noodle",
  "Steamed Rice and Side Dishes",
];

const DEFAULT_SET = new Set(DEFAULT_POS_CATEGORIES);

/** The default (before anyone sets the flag) for a product's category. */
export function defaultShowOnPos(category: string): boolean {
  return DEFAULT_SET.has(category);
}

/** Does this product appear on the POS screen? The per-product flag wins. */
export function isShownOnPos(p: Pick<Product, "showOnPos" | "category">): boolean {
  return p.showOnPos ?? defaultShowOnPos(p.category);
}
