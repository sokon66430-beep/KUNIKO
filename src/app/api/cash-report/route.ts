import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { drawerFor } from "@/lib/money";
import { storeToday } from "@/lib/storetime";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Cash reporting: per-shift rows (the Shift Cash Report), a daily roll-up (the
// Daily Cash Report) and cashier performance. Filterable by day, terminal,
// cashier and shift. Read-only — profit is not involved, so no redaction.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  const p = new URL(req.url).searchParams;
  const day = p.get("date"); // yyyy-mm-dd, store timezone
  const terminal = p.get("posTerminalId");
  const cashier = p.get("cashier");
  const shiftName = p.get("shift");
  const shiftId = p.get("shiftId"); // one specific shift — the till's live Safe Drop report

  let shifts = [...db.shifts];
  if (day) shifts = shifts.filter((s) => storeToday(new Date(s.openedAt)) === day);
  if (terminal) shifts = shifts.filter((s) => s.posTerminalId === terminal);
  if (cashier) shifts = shifts.filter((s) => s.cashier === cashier);
  if (shiftName) shifts = shifts.filter((s) => s.shift === shiftName);
  shifts.sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  const rows = shifts.map((s) => {
    const d = drawerFor(db, s);
    return {
      id: s.id,
      posTerminalId: s.posTerminalId,
      shift: s.shift,
      cashier: s.cashier,
      status: s.status,
      openedAt: s.openedAt,
      closedAt: s.closedAt ?? null,
      openingFloat: d.opening,
      cashSales: d.cashSales,
      cashIn: d.cashIn,
      cashOut: d.cashOut,
      drop: d.drop,
      refunds: d.refunds,
      expected: s.expectedCash ?? d.expected,
      actual: s.actualCash ?? null,
      variance: s.variance ?? null,
      varianceReason: s.varianceReason ?? null,
      salesTotal: d.sales.total,
      card: d.sales.card,
      ewallet: d.sales.ewallet,
    };
  });

  // Daily roll-up across the filtered shifts.
  const totals = rows.reduce(
    (t, r) => ({
      openingFloat: round2(t.openingFloat + r.openingFloat),
      cashSales: round2(t.cashSales + r.cashSales),
      cashIn: round2(t.cashIn + r.cashIn),
      cashOut: round2(t.cashOut + r.cashOut),
      drop: round2(t.drop + r.drop),
      refunds: round2(t.refunds + r.refunds),
      expected: round2(t.expected + r.expected),
      actual: round2(t.actual + (r.actual ?? 0)),
      variance: round2(t.variance + (r.variance ?? 0)),
      salesTotal: round2(t.salesTotal + r.salesTotal),
    }),
    { openingFloat: 0, cashSales: 0, cashIn: 0, cashOut: 0, drop: 0, refunds: 0, expected: 0, actual: 0, variance: 0, salesTotal: 0 },
  );

  // Cashier performance across the filtered set.
  const perf = new Map<string, { cashier: string; shifts: number; salesTotal: number; variance: number; drops: number; refunds: number }>();
  for (const s of shifts) {
    const d = drawerFor(db, s);
    const e = perf.get(s.cashier) ?? { cashier: s.cashier, shifts: 0, salesTotal: 0, variance: 0, drops: 0, refunds: 0 };
    e.shifts += 1;
    e.salesTotal = round2(e.salesTotal + d.sales.total);
    e.variance = round2(e.variance + (s.variance ?? 0));
    e.drops += d.counts.drops;
    e.refunds += d.counts.refunds;
    perf.set(s.cashier, e);
  }

  // --- Safe Drop report ------------------------------------------------------
  // Every drop to the safe under the same filters, with the DOLLARS part and the
  // RIEL part kept separate — so the count in the safe can be checked note for
  // note in each currency. Older drops recorded before the split are all-USD.
  const shiftById = new Map(db.shifts.map((s) => [s.id, s]));
  let dropMoves = db.cashMovements.filter((m) => m.type === "DROP");
  if (shiftId) dropMoves = dropMoves.filter((m) => m.shiftId === shiftId);
  if (day) dropMoves = dropMoves.filter((m) => storeToday(new Date(m.at)) === day);
  if (terminal) dropMoves = dropMoves.filter((m) => m.posTerminalId === terminal);
  if (cashier) dropMoves = dropMoves.filter((m) => m.createdBy === cashier);
  if (shiftName) dropMoves = dropMoves.filter((m) => shiftById.get(m.shiftId)?.shift === shiftName);
  dropMoves.sort((a, b) => b.at.localeCompare(a.at));

  const drops = dropMoves.map((m) => ({
    id: m.id,
    at: m.at,
    posTerminalId: m.posTerminalId,
    shift: shiftById.get(m.shiftId)?.shift ?? "—",
    by: m.createdBy,
    reason: m.reason,
    bagColor: m.bagColor,
    // Pre-split drops carry only `amount` (USD) — show them as dollars.
    usd: round2(m.amountUsd ?? m.amount),
    riel: m.amountRiel ?? 0,
    usdEquivalent: round2(m.amount),
    status: m.status,
  }));
  const dropTotals = drops.reduce(
    (t, d) => ({
      usd: round2(t.usd + d.usd),
      riel: t.riel + d.riel,
      usdEquivalent: round2(t.usdEquivalent + d.usdEquivalent),
      count: t.count + 1,
    }),
    { usd: 0, riel: 0, usdEquivalent: 0, count: 0 },
  );

  // --- Bank Deposit report ---------------------------------------------------
  // Cash deposited to the store's bank under the same filters, DOLLARS and RIEL
  // kept separate, each stamped with the bank and the deposit-slip reference so
  // it can be matched against the bank statement.
  let bankMoves = db.cashMovements.filter((m) => m.type === "BANK_DEPOSIT");
  if (shiftId) bankMoves = bankMoves.filter((m) => m.shiftId === shiftId);
  if (day) bankMoves = bankMoves.filter((m) => storeToday(new Date(m.at)) === day);
  if (terminal) bankMoves = bankMoves.filter((m) => m.posTerminalId === terminal);
  if (cashier) bankMoves = bankMoves.filter((m) => m.createdBy === cashier);
  if (shiftName) bankMoves = bankMoves.filter((m) => shiftById.get(m.shiftId)?.shift === shiftName);
  bankMoves.sort((a, b) => b.at.localeCompare(a.at));

  const bankDeposits = bankMoves.map((m) => ({
    id: m.id,
    at: m.at,
    posTerminalId: m.posTerminalId,
    shift: shiftById.get(m.shiftId)?.shift ?? "—",
    by: m.createdBy,
    reason: m.reason,
    bank: m.bank ?? "",
    reference: m.reference ?? "",
    usd: round2(m.amountUsd ?? m.amount),
    riel: m.amountRiel ?? 0,
    usdEquivalent: round2(m.amount),
    status: m.status,
  }));
  const bankTotals = bankDeposits.reduce(
    (t, d) => ({
      usd: round2(t.usd + d.usd),
      riel: t.riel + d.riel,
      usdEquivalent: round2(t.usdEquivalent + d.usdEquivalent),
      count: t.count + 1,
    }),
    { usd: 0, riel: 0, usdEquivalent: 0, count: 0 },
  );

  return NextResponse.json({
    day: day ?? null,
    terminals: [...new Set(db.shifts.map((s) => s.posTerminalId))].sort(),
    cashiers: [...new Set(db.shifts.map((s) => s.cashier))].sort(),
    rows,
    totals,
    drops,
    dropTotals,
    bankDeposits,
    bankTotals,
    cashierPerformance: [...perf.values()].sort((a, b) => b.salesTotal - a.salesTotal),
  });
}
