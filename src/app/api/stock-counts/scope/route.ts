import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { assortmentIds } from "@/lib/assortment";

export const dynamic = "force-dynamic";

// How big is THIS store's count, really? Master Sync gives every store the
// whole catalog, so products.length says 4,250 for a branch that ranges 800 —
// the count modal needs the carried figure for its "N of M counted" line, and
// only the server can derive it (it's implied by sales/PR/PO/receiving history
// the client doesn't load).
export async function GET() {
  const db = await readDB();
  return NextResponse.json({
    carried: assortmentIds(db).size,
    catalog: db.products.length,
  });
}
