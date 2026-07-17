import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterSuppliers, propagateSuppliersToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// POST /api/master/suppliers/sync?storeId=  — push the master supplier list
// into every store, or just the one named (owner-only). Supplier edits already
// mirror automatically on save; this re-syncs everything on demand — same
// concept as the product "Sync to stores".
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get("storeId") || undefined;
  const sys = await readSystem();
  // Checked before the push: an unknown id syncs NOTHING, and reporting that as
  // success would look like it worked.
  const target = storeId ? sys.stores.find((st) => st.id === storeId) : undefined;
  if (storeId && !target) return NextResponse.json({ error: "No such store." }, { status: 400 });

  await propagateSuppliersToStores(storeId);
  const master = await readMasterSuppliers();
  return NextResponse.json({
    suppliers: master.length,
    stores: target ? 1 : sys.stores.length,
    storeNames: target ? [target.name] : sys.stores.map((st) => st.name),
  });
}
