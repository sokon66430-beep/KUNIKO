import type { CashCount, DB, Sale, Shift } from "./types";

// ---------------------------------------------------------------------------
// Cash drawer maths. One source of truth for what a shift's drawer should hold,
// so the till, the close screen and the report can never disagree.
//
//   expected = opening float
//            + cash sales
//            + cash in
//            − cash out
//            − safe drops
//            − cash refunds
//
// Movements affect the drawer as soon as they're recorded — the money has
// physically moved — and `approvedBy` is the oversight trail on top, not a gate
// on the arithmetic. Cash sales are the sales stamped with this shift's id.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

// USD notes counted at the till, largest first. Loose coins are a single lump
// (CashCount.coins) so a count stays fast. No $100 — the store doesn't take it.
export const CASH_DENOMS = [50, 20, 10, 5, 1];
// Khmer riel notes counted alongside — the store takes both currencies. No
// 100,000៛ note (not handled here); the 100៛ note is counted at the bottom.
export const RIEL_DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 100];
// Fallback KHR-per-USD if a store has no rate set.
const DEFAULT_RATE = 4100;

/**
 * Total value of a counted stack, in USD. USD notes + loose coins at face value;
 * riel notes converted at the store's exchange rate (KHR per 1 USD). The books
 * are kept in dollars, so the drawer figure is one currency even though the
 * cashier counts two.
 */
export function countTotal(c?: CashCount | null, exchangeRate = DEFAULT_RATE): number {
  if (!c) return 0;
  const usd = (c.denoms || []).reduce((s, d) => s + (Number(d.denom) || 0) * (Number(d.count) || 0), 0);
  const riel = (c.riel || []).reduce((s, d) => s + (Number(d.denom) || 0) * (Number(d.count) || 0), 0);
  const rate = exchangeRate > 0 ? exchangeRate : DEFAULT_RATE;
  return round2(usd + (Number(c.coins) || 0) + riel / rate);
}

/** The open shift on a given terminal, if any. One open shift per till. */
export function openShiftForTerminal(db: DB, posTerminalId: string): Shift | undefined {
  return db.shifts.find((s) => s.status === "open" && s.posTerminalId === posTerminalId);
}

/** All open shifts (across terminals) — for the money dashboard. */
export function openShifts(db: DB): Shift[] {
  return db.shifts.filter((s) => s.status === "open");
}

export type Drawer = {
  opening: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  drop: number;
  refunds: number;
  // Cash transferred from the SAFE to the bank this shift. Does NOT touch the
  // till drawer (the money came from the safe, not the till).
  bankDeposit: number;
  // The store SAFE: all safe drops (gross), all bank transfers (gross), and the
  // net balance sitting in the safe. Store-wide, spans shifts.
  safe: { dropUsd: number; dropRiel: number; txUsd: number; txRiel: number; usd: number; riel: number; usdEquivalent: number };
  // Cash handed back for CANCELLED invoices this shift. Informational only:
  // a cancelled sale is already excluded from cashSales, so expected drops by
  // itself — this figure just shows the money that went back.
  refundedCancelled: number;
  expected: number;
  // Payment mix over the shift, for the dashboard.
  sales: { total: number; cash: number; card: number; ewallet: number };
  // The pure-dollar portion of each movement type (the riel part is separate,
  // below), so the drawer can show dollars and riel side by side, never merged.
  usd: { cashIn: number; cashOut: number; drop: number; refunds: number; bankDeposit: number };
  // The riel-note portion of each movement type, kept in riel (not converted),
  // so the drawer can show a total in both currencies.
  riel: { cashIn: number; cashOut: number; drop: number; refunds: number; bankDeposit: number };
  counts: { movements: number; drops: number; refunds: number; bankDeposits: number };
};

// How each payment method buckets on the dashboard. Cash is its own; ABA/Card
// are card; KHQR/Wing are e-wallet.
function bucket(method: string): "cash" | "card" | "ewallet" {
  if (method === "Cash") return "cash";
  if (method === "ABA" || method === "Card") return "card";
  return "ewallet"; // KHQR, Wing, anything else digital
}

export function drawerFor(db: DB, shift: Shift): Drawer {
  const shiftSales = db.sales.filter((s: Sale) => s.shiftId === shift.id && !s.cancelled);
  const sales = { total: 0, cash: 0, card: 0, ewallet: 0 };
  for (const s of shiftSales) {
    sales.total = round2(sales.total + s.total);
    sales[bucket(s.paymentMethod)] = round2(sales[bucket(s.paymentMethod)] + s.total);
  }

  // Cash invoices cancelled this shift: the sale above is already excluded, so
  // the expected drawer self-corrects — this is the "handed back" figure shown
  // on the dashboard, not part of the arithmetic.
  const refundedCancelled = round2(
    db.sales
      .filter((s: Sale) => s.shiftId === shift.id && s.cancelled && bucket(s.paymentMethod) === "cash")
      .reduce((t, s) => t + s.total, 0),
  );

  const mv = db.cashMovements.filter((m) => m.shiftId === shift.id);
  const sumOf = (t: string) => round2(mv.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0));
  const rielOf = (t: string) => mv.filter((m) => m.type === t).reduce((s, m) => s + (Number(m.amountRiel) || 0), 0);
  // The pure DOLLAR part of each movement (not the riel converted in). Older
  // pre-split movements carry only `amount` (all-USD), so fall back to that.
  const usdOf = (t: string) => round2(mv.filter((m) => m.type === t).reduce((s, m) => s + (Number(m.amountUsd ?? m.amount) || 0), 0));
  const cashIn = sumOf("CASH_IN");
  const cashOut = sumOf("CASH_OUT");
  const drop = sumOf("DROP");
  const refunds = sumOf("REFUND");
  const bankDeposit = sumOf("BANK_DEPOSIT");

  // A bank deposit takes cash from the SAFE (money that was safe-dropped), not
  // from the till — so it does NOT reduce the drawer. Only safe drops, refunds
  // (and legacy cash in/out) move the till.
  const expected = round2(shift.openingFloat + sales.cash + cashIn - cashOut - drop - refunds);

  // The store SAFE balance: everything safe-dropped (from any shift) minus what
  // has been transferred to the bank. This is the cash sitting in the safe,
  // available to transfer — dollars and riel kept separate. Store-wide, so it
  // spans shifts (the safe isn't reset when a shift closes).
  const all = db.cashMovements;
  const sumAll = (t: string) => round2(all.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0));
  const usdAll = (t: string) => round2(all.filter((m) => m.type === t).reduce((s, m) => s + (Number(m.amountUsd ?? m.amount) || 0), 0));
  const rielAll = (t: string) => all.filter((m) => m.type === t).reduce((s, m) => s + (Number(m.amountRiel) || 0), 0);
  const safe = {
    dropUsd: usdAll("DROP"),
    dropRiel: rielAll("DROP"),
    txUsd: usdAll("BANK_DEPOSIT"),
    txRiel: rielAll("BANK_DEPOSIT"),
    usd: round2(usdAll("DROP") - usdAll("BANK_DEPOSIT")),
    riel: rielAll("DROP") - rielAll("BANK_DEPOSIT"),
    usdEquivalent: round2(sumAll("DROP") - sumAll("BANK_DEPOSIT")),
  };

  return {
    opening: round2(shift.openingFloat),
    cashSales: sales.cash,
    cashIn,
    cashOut,
    drop,
    refunds,
    bankDeposit,
    safe,
    refundedCancelled,
    expected,
    sales,
    // Pure-dollar and pure-riel parts of each movement, kept apart so the drawer
    // can show dollars and riel as two separate amounts (never merged into one).
    usd: { cashIn: usdOf("CASH_IN"), cashOut: usdOf("CASH_OUT"), drop: usdOf("DROP"), refunds: usdOf("REFUND"), bankDeposit: usdOf("BANK_DEPOSIT") },
    riel: { cashIn: rielOf("CASH_IN"), cashOut: rielOf("CASH_OUT"), drop: rielOf("DROP"), refunds: rielOf("REFUND"), bankDeposit: rielOf("BANK_DEPOSIT") },
    counts: {
      movements: mv.length,
      drops: mv.filter((m) => m.type === "DROP").length,
      refunds: mv.filter((m) => m.type === "REFUND").length,
      bankDeposits: mv.filter((m) => m.type === "BANK_DEPOSIT").length,
    },
  };
}

/** Over the drawer ceiling? Drives the "please do a safe drop" alert. */
export function overDrawerLimit(expected: number, limit?: number): boolean {
  return !!limit && limit > 0 && expected > limit;
}

/** How much to drop to bring the drawer back to the limit. */
export function recommendedDrop(expected: number, limit?: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, round2(expected - limit));
}
