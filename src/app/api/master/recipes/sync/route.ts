import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterRecipes, propagateRecipesToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// POST /api/master/recipes/sync?storeId=  — push the master recipes into every
// store, or just the one named (owner-only).
//
// Recipe edits already mirror automatically on save; this is the catch-up
// button — a store added after a recipe was written, or one copy someone
// doubts. Same concept as the product and supplier "Sync to stores".
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get("storeId") || undefined;
  const sys = await readSystem();
  // Checked before the push, not after: an unknown id syncs NOTHING, and
  // reporting "synced to 0 stores" as success would look like it worked.
  const target = storeId ? sys.stores.find((st) => st.id === storeId) : undefined;
  if (storeId && !target) return NextResponse.json({ error: "No such store." }, { status: 400 });

  await propagateRecipesToStores(storeId);
  const master = await readMasterRecipes();
  return NextResponse.json({
    recipes: master.items.length,
    stores: target ? [target.name] : sys.stores.map((st) => st.name),
  });
}
