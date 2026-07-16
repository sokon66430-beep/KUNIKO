import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterSuppliers, propagateSuppliersToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// Push the master supplier list into every store (owner-only). Supplier edits
// already mirror automatically on save; this button re-syncs everything on
// demand — same concept as the product "Sync to stores".
export async function POST() {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await propagateSuppliersToStores();
  const master = await readMasterSuppliers();
  const sys = await readSystem();
  return NextResponse.json({ suppliers: master.length, stores: sys.stores.length });
}
