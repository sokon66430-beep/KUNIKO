import type { WriteOffUnitType } from "./types";

// Decide how a product is measured from its unit string, so the write-off form
// knows whether to accept pieces, weight (kg/g), or volume (L/ml).
const WEIGHT = new Set(["kg", "g", "gm", "gram", "grams", "kilogram", "kilo", "mg"]);
const VOLUME = new Set(["l", "ml", "cl", "liter", "litre", "liters", "litres", "lt"]);

export function measureType(unit: string | undefined): WriteOffUnitType {
  const u = (unit || "").trim().toLowerCase();
  if (WEIGHT.has(u)) return "weight";
  if (VOLUME.has(u)) return "volume";
  // catch things like "500g", "1.5kg", "250ml"
  if (/\d\s*(kg|g|gm|mg)$/.test(u)) return "weight";
  if (/\d\s*(l|ml|cl)$/.test(u)) return "volume";
  return "unit";
}

// Sensible step + placeholder for the quantity input by measure type.
export function qtyStep(t: WriteOffUnitType): number {
  return t === "unit" ? 1 : 0.01;
}

export const UNIT_TYPE_LABEL: Record<WriteOffUnitType, string> = {
  unit: "Units (pcs)",
  weight: "Weight (kg / g)",
  volume: "Volume (L / ml)",
};
