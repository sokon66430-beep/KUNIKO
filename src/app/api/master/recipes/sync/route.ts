import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterRecipes, propagateRecipesToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// Push the master recipes into every store (owner-only). Recipe edits already
// mirror automatically on save; this button re-syncs everything on demand —
// same concept as the product and supplier "Sync to stores", and the way a
// store added after a recipe was written catches up.
export async function POST() {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await propagateRecipesToStores();
  const master = await readMasterRecipes();
  const sys = await readSystem();
  return NextResponse.json({ recipes: master.items.length, stores: sys.stores.length });
}
