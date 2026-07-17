import type { Product } from "./types";

// ---------------------------------------------------------------------------
// Barcodes
//
// A product can carry more than one code. Real reasons: the supplier changed
// packaging and both are on the shelf, the same item ships from two plants, or
// the POS export simply recorded two.
//
// The imported ON Mart master put them in ONE field, comma-separated
// ("8992388134618,8992388134618"). Every scan compares the whole field for
// equality, so a product stored that way matched NOTHING — scanning either of
// its real codes found nothing at all. This module is the one place that knows
// a product may have several codes, so nowhere else has to remember.
//
// `barcode` stays the primary — it's what price labels print and what a PO
// line snapshots. `altBarcodes` are the others: never printed, always scanned.
// ---------------------------------------------------------------------------

/**
 * Split a raw barcode field into its codes, in order, deduplicated.
 *
 * Handles the comma/semicolon/whitespace forms the master actually contains.
 * Deduping matters: 23 of the master's 71 multi-code fields are the SAME code
 * written twice, which is not a second barcode, just noise.
 */
export function splitBarcodeField(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/** Every code this product answers to — primary first. */
export function barcodesOf(p: Pick<Product, "barcode" | "altBarcodes">): string[] {
  // The primary may itself still hold an unsplit field (a product edited by
  // hand, or read before the repair ran), so it goes through the splitter too.
  return [...new Set([...splitBarcodeField(p.barcode), ...(p.altBarcodes || [])])];
}

/** Does this product answer to `code`? Exact match on any of its codes. */
export function matchesBarcode(p: Pick<Product, "barcode" | "altBarcodes">, code: string): boolean {
  const q = code.trim();
  if (!q) return false;
  return barcodesOf(p).includes(q);
}

/** Does any of this product's codes contain `text`? For type-ahead search. */
export function barcodeIncludes(p: Pick<Product, "barcode" | "altBarcodes">, text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return barcodesOf(p).some((b) => b.includes(q));
}

/**
 * Every product answering to `code`.
 *
 * Returns a LIST, not a single product: the imported master has ~123 products
 * sharing barcodes with each other, so a scan genuinely can be ambiguous and
 * the caller must be able to ask which one rather than be handed a guess.
 */
export function findByBarcode<T extends Pick<Product, "barcode" | "altBarcodes">>(list: T[], code: string): T[] {
  const q = code.trim();
  if (!q) return [];
  return list.filter((p) => matchesBarcode(p, q));
}

/** The codes for display: "8992388134618 + 1 more", or just the one. */
export function describeBarcodes(p: Pick<Product, "barcode" | "altBarcodes">): string {
  const all = barcodesOf(p);
  if (all.length === 0) return "";
  if (all.length === 1) return all[0];
  return `${all[0]} +${all.length - 1}`;
}

/**
 * Repair a product whose codes are still crammed into one field.
 * Returns true when it changed something, so callers can report the count.
 */
export function repairBarcodes(p: Product): boolean {
  const codes = splitBarcodeField(p.barcode);
  if (codes.length <= 1) {
    // Already single — but a field of "X,X" collapses to one code and still
    // needs writing back, since the stored string is the unscannable version.
    if (codes.length === 1 && p.barcode !== codes[0]) {
      p.barcode = codes[0];
      return true;
    }
    return false;
  }
  const [primary, ...rest] = codes;
  const existing = p.altBarcodes || [];
  p.barcode = primary;
  p.altBarcodes = [...new Set([...rest, ...existing])];
  return true;
}
