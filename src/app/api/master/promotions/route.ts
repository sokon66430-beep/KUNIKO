import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterPromotions } from "@/lib/master";

export const dynamic = "force-dynamic";

// GET /api/master/promotions — the central deal list, highest priority first
// (the order they compete in at the till), then newest.
//
// Read-only for the same reason as /api/master/recipes: deals are written on
// /deals, which already writes here and mirrors out.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const master = await readMasterPromotions();
  const items = [...master.items].sort(
    (a, b) => b.priority - a.priority || +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return NextResponse.json(items);
}
