import { NextResponse } from "next/server";
import { resetDB } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Wipes the current store back to seed — sales, stock, cash, counts, the lot.
// Destructive, so owner only: middleware alone only requires *a* login, which
// would let any signed-in cashier erase the store.
export async function POST() {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }
  await resetDB();
  return NextResponse.json({ ok: true });
}
