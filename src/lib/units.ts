// ---------------------------------------------------------------------------
// Units of measure + conversion
//
// A recipe is written the way a cook thinks ("80 g beef", "300 ml soup base"),
// but stock is counted the way the store buys ("10 kg", "24 pcs"). This module
// is the only place that knows how to get from one to the other.
//
// Every unit resolves to a BASE unit within its dimension — g for weight, ml
// for volume, pcs for count — so conversion is just base-in / base-out. Two
// units can only convert when they share a dimension: there is no honest answer
// for "how many ml is 3 pcs", so we return null and let the caller say so
// rather than guessing a number that would quietly corrupt stock.
// ---------------------------------------------------------------------------

export type UnitDimension = "weight" | "volume" | "count";

export type UnitDef = {
  code: string;
  label: string;
  dim: UnitDimension;
  // How many base units one of this unit is worth. `null` means it depends on
  // the product (a "pack" of eggs is 10, a pack of straws is 100) — the size
  // comes from the product's own packSize/boxSize.
  base: number | null;
};

export const UNITS: UnitDef[] = [
  { code: "g", label: "Gram (g)", dim: "weight", base: 1 },
  { code: "kg", label: "Kilogram (kg)", dim: "weight", base: 1000 },
  { code: "ml", label: "Millilitre (ml)", dim: "volume", base: 1 },
  { code: "L", label: "Litre (L)", dim: "volume", base: 1000 },
  { code: "pcs", label: "Pieces (pcs)", dim: "count", base: 1 },
  { code: "unit", label: "Unit", dim: "count", base: 1 },
  // A slice IS one piece as far as stock goes — cheese and ham are stocked by
  // the slice. It exists so a recipe can read "2 slices" instead of "2 pcs".
  { code: "slice", label: "Slice", dim: "count", base: 1 },
  { code: "pack", label: "Pack", dim: "count", base: null },
  { code: "box", label: "Box", dim: "count", base: null },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code.toLowerCase(), u]));

// What people actually type / what the imported master already contains. "U" is
// the unit every one of the imported ON Mart products carries.
const ALIASES: Record<string, string> = {
  u: "unit",
  ea: "unit",
  each: "unit",
  units: "unit",
  pc: "pcs",
  pce: "pcs",
  piece: "pcs",
  pieces: "pcs",
  gm: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  kilo: "kg",
  kilogram: "kg",
  kgs: "kg",
  l: "L",
  lt: "L",
  ltr: "L",
  liter: "L",
  litre: "L",
  liters: "L",
  litres: "L",
  mls: "ml",
  millilitre: "ml",
  milliliter: "ml",
  packs: "pack",
  pkt: "pack",
  packet: "pack",
  boxes: "box",
  ctn: "box",
  carton: "box",
  case: "box",
  slices: "slice",
  sl: "slice",
};

/** Resolve any spelling of a unit to a known code, or null if we don't know it. */
export function normalizeUnit(raw: string | undefined): string | null {
  const key = (raw || "").trim().toLowerCase();
  if (!key) return null;
  const aliased = ALIASES[key] || key;
  const def = BY_CODE.get(aliased.toLowerCase());
  return def ? def.code : null;
}

export function unitDef(raw: string | undefined): UnitDef | null {
  const code = normalizeUnit(raw);
  return code ? BY_CODE.get(code.toLowerCase()) || null : null;
}

export function unitDimension(raw: string | undefined): UnitDimension | null {
  return unitDef(raw)?.dim ?? null;
}

/**
 * The stock units a recipe can convert from, for telling the user what to type.
 *
 * Built from UNITS rather than written out by hand: the hand-written list in the
 * product editor had gone stale and omitted "slice", so a perfectly valid unit
 * looked unsupported. Deriving it means the message can never drift again.
 */
export const UNIT_CODES: string = UNITS.map((u) => u.code).join(", ");

/**
 * How a product's pack/box units are sized, and what one piece CONTAINS
 * (pieceSize + pieceSizeUnit, e.g. 1000 g) — all off the product record.
 */
export type PackSizes = {
  packSize?: number;
  boxSize?: number;
  pieceSize?: number;
  pieceSizeUnit?: string;
};

/**
 * How many base units one `unit` is worth for this product, or null when the
 * product hasn't been told how big its pack/box is.
 */
export function unitBase(raw: string | undefined, sizes: PackSizes = {}): number | null {
  const def = unitDef(raw);
  if (!def) return null;
  if (def.base != null) return def.base;
  const size = def.code === "pack" ? sizes.packSize : sizes.boxSize;
  return size && size > 0 ? size : null;
}

// Float noise: 0.1 + 0.2 arithmetic on grams would leave stock at 9.919999999.
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Convert `qty` from one unit to another for a given product, or null when the
 * conversion isn't defined (different dimensions, unknown unit, or a pack whose
 * size nobody has set).
 */
export function convert(qty: number, from: string | undefined, to: string | undefined, sizes: PackSizes = {}): number | null {
  const a = unitDef(from);
  const b = unitDef(to);
  if (!a || !b) return null;
  if (a.dim !== b.dim) return convertAcross(qty, a, b, sizes);
  const fromBase = unitBase(from, sizes);
  const toBase = unitBase(to, sizes);
  if (fromBase == null || toBase == null || toBase === 0) return null;
  return clean((qty * fromBase) / toBase);
}

/**
 * Count ↔ weight/volume, via what one piece CONTAINS.
 *
 * "45 g of a 1000 g pack" has an honest answer ONLY when the product says how
 * much one piece holds (pieceSize + pieceSizeUnit). With that, 45 g = 0.045
 * pieces — without it, we still refuse to guess.
 */
function convertAcross(qty: number, a: UnitDef, b: UnitDef, sizes: PackSizes): number | null {
  const piece = unitDef(sizes.pieceSizeUnit);
  const size = sizes.pieceSize;
  if (!piece || piece.base == null || !size || size <= 0) return null;
  const perPiece = size * piece.base; // grams (or ml) inside ONE piece

  // Counting → measuring: pieces × contents.
  if (a.dim === "count" && b.dim === piece.dim) {
    const pieces = unitBase(a.code, sizes); // pieces in one `from` unit
    const toBase = unitBase(b.code, sizes);
    if (pieces == null || toBase == null || toBase === 0) return null;
    return clean((qty * pieces * perPiece) / toBase);
  }
  // Measuring → counting: amount ÷ contents.
  if (b.dim === "count" && a.dim === piece.dim) {
    const fromBase = unitBase(a.code, sizes);
    const toPieces = unitBase(b.code, sizes); // pieces in one `to` unit
    if (fromBase == null || toPieces == null || toPieces === 0) return null;
    return clean((qty * fromBase) / perPiece / toPieces);
  }
  return null;
}

/**
 * Why a conversion can't be done, phrased for the person who has to fix it.
 * Returns null when the conversion is fine.
 */
export function conversionProblem(
  from: string | undefined,
  to: string | undefined,
  sizes: PackSizes = {},
): string | null {
  const a = unitDef(from);
  const b = unitDef(to);
  if (!a) return `"${from || "—"}" isn't a unit the system knows`;
  if (!b) return `stock unit "${to || "—"}" isn't a unit the system knows`;
  if (a.dim !== b.dim) {
    // The piece bridge ("one unit contains 1000 g") may make this convertible —
    // only complain when it genuinely can't be done.
    if (convert(1, from, to, sizes) != null) return null;
    const count = a.dim === "count" ? a : b.dim === "count" ? b : null;
    const measure = a.dim !== "count" ? a : b.dim !== "count" ? b : null;
    if (count && measure) {
      const eg = measure.dim === "weight" ? "1000 g" : "1000 ml";
      return `stock is counted in ${count.code} — set “one ${count.code} contains” on the product (e.g. ${eg}) so ${measure.code} can convert`;
    }
    return `can't convert ${a.code} (${a.dim}) into ${b.code} (${b.dim})`;
  }
  if (unitBase(from, sizes) == null) return `set how many pieces are in one ${a.code} first`;
  if (unitBase(to, sizes) == null) return `set how many pieces are in one ${b.code} first`;
  return null;
}

/** Units that can be used against a product whose stock is counted in `stockUnit`. */
export function compatibleUnits(stockUnit: string | undefined): UnitDef[] {
  const dim = unitDimension(stockUnit);
  if (!dim) return UNITS;
  return UNITS.filter((u) => u.dim === dim);
}

/**
 * EVERY unit, the ones compatible with `stockUnit` first. The recipe editor
 * lists them all — hiding kg/g/ml just looked like the system didn't have them.
 * Picking an incompatible one gets the inline explanation (with the fix) from
 * conversionProblem instead of a silent dead end.
 */
export function unitChoices(stockUnit: string | undefined): UnitDef[] {
  const dim = unitDimension(stockUnit);
  if (!dim) return UNITS;
  return [...UNITS.filter((u) => u.dim === dim), ...UNITS.filter((u) => u.dim !== dim)];
}

/** Tidy display of a quantity + unit, e.g. "0.08 kg", "150 g", "3 pcs". */
export function formatQty(qty: number, unit: string | undefined): string {
  const n = clean(qty || 0);
  const text = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
  return `${text} ${normalizeUnit(unit) || unit || ""}`.trim();
}
