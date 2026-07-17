import type { DB, LedgerEntry, LedgerEntryType, Product } from "./types";

// ---------------------------------------------------------------------------
// The one door stock walks through.
//
// Every change to product.stock goes via postLedger(): it applies the signed
// quantity AND writes the ledger entry with the balance after, atomically
// within the caller's mutateDB. That's what makes the ledger trustworthy —
// there is no code path that moves stock without leaving a line, and no line
// that didn't move stock (setStock, below, is the one explicit exception and
// says so on its entry).
//
// Callers pass the DELTA, signed: receiving +, sales −, a write-off −, its
// cancellation +. The balance column is derived here, never by the caller.
// ---------------------------------------------------------------------------

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function postLedger(
  db: DB,
  product: Product,
  entry: {
    type: LedgerEntryType;
    qty: number; // signed delta
    by: string;
    ref?: string;
    note?: string;
    at?: string;
    // Floor the resulting stock at zero (write-offs and counts already work
    // this way). The ledger records what was actually applied, so a clamped
    // movement shows the clamped qty — the book always adds up.
    clampAtZero?: boolean;
  },
): LedgerEntry {
  let applied = entry.qty;
  const target = round6(product.stock + applied);
  const balance = entry.clampAtZero && target < 0 ? 0 : target;
  if (balance !== target) applied = round6(balance - product.stock);
  product.stock = balance;
  const row: LedgerEntry = {
    id: `LG-${String(db.meta.nextLedger++).padStart(6, "0")}`,
    at: entry.at || new Date().toISOString(),
    type: entry.type,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    barcode: product.barcode,
    qty: applied,
    balance,
    ref: entry.ref,
    by: entry.by,
    note: entry.note,
  };
  db.ledger.push(row);
  return row;
}

/**
 * Set stock to an absolute figure (opening balance, or a count correcting a
 * broken number). The entry's qty is the true delta from wherever stock was,
 * so the ledger still sums: prior stock + qty = balance. The note carries what
 * was discarded when that matters (e.g. opening over a junk figure).
 */
export function setStockTo(
  db: DB,
  product: Product,
  target: number,
  entry: { type: LedgerEntryType; by: string; ref?: string; note?: string },
): LedgerEntry {
  return postLedger(db, product, { ...entry, qty: round6(target - product.stock) });
}
