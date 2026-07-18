import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { drawerFor } from "@/lib/money";

export const dynamic = "force-dynamic";

// One shift with its live drawer, its cash movements and the sales attributed to
// it — everything the drawer / close screen needs.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  const shift = db.shifts.find((s) => s.id === params.id);
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  const movements = db.cashMovements
    .filter((m) => m.shiftId === shift.id)
    .sort((a, b) => b.at.localeCompare(a.at));
  const sales = db.sales
    .filter((s) => s.shiftId === shift.id)
    .map((s) => ({ invoiceNo: s.invoiceNo, total: s.total, paymentMethod: s.paymentMethod, createdAt: s.createdAt }));

  return NextResponse.json({
    shift,
    drawer: drawerFor(db, shift),
    movements,
    sales,
    drawerLimit: db.meta.business.cashDrawerLimit ?? 0,
    exchangeRate: db.meta.business.exchangeRate ?? 4100,
  });
}
