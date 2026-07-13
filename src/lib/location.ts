import type { Product, ProductLocation } from "./types";

// Every place a product sits. Uses the `locations` list when present, else
// falls back to the single gondola/shelf (older records / single-location).
export function productLocations(p: Pick<Product, "gondola" | "shelf" | "locations">): ProductLocation[] {
  if (p.locations && p.locations.length) return p.locations;
  if (p.gondola || p.shelf) return [{ gondola: p.gondola || "", shelf: p.shelf || "" }];
  return [];
}

// One place → "A12/3" (gondola/shelf). Missing halves degrade gracefully.
export function formatLocation(l: ProductLocation): string {
  const g = (l.gondola || "").trim();
  const s = (l.shelf || "").trim();
  if (g && s) return `${g}/${s}`;
  return g || s || "";
}

// All places joined for a report cell, e.g. "A12/3, B05/2".
export function formatLocations(p: Pick<Product, "gondola" | "shelf" | "locations">): string {
  return productLocations(p).map(formatLocation).filter(Boolean).join(", ");
}
