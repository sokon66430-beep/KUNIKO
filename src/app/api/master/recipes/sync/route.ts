import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterRecipes, propagateRecipesToStores, parseStoreIds } from "@/lib/master";

export const dynamic = "force-dynamic";

// POST /api/master/recipes/sync?storeIds=a,b  — push the master recipes into
// the named stores, or every store when none are named (owner-only).
//
// Recipe edits already mirror automatically on save; this is the catch-up
// button — a store added after a recipe was written, or a copy someone doubts.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const target = await parseStoreIds(req.url);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  await propagateRecipesToStores(target.ids);
  const master = await readMasterRecipes();
  return NextResponse.json({ recipes: master.items.length, stores: target.stores.map((s) => s.name) });
}
