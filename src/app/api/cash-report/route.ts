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

  return NextResponse.json({
    day: day ?? null,
    terminals: [...new Set(db.shifts.map((s) => s.posTerminalId))].sort(),
    cashiers: [...new Set(db.shifts.map((s) => s.cashier))].sort(),
    rows,
    totals,
    cashierPerformance: [...perf.values()].sort((a, b) => b.salesTotal - a.salesTotal),
  });
}
