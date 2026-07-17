import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterSuppliers, propagateSuppliersToStores, parseStoreIds } from "@/lib/master";

export const dynamic = "force-dynamic";

// POST /api/master/suppliers/sync?storeIds=a,b  — push the master supplier list
// into the named stores, or every store when none are named (owner-only).
// Supplier edits already mirror automatically on save; this re-syncs on demand
// — same concept as the product "Sync".
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const target = await parseStoreIds(req.url);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  await propagateSuppliersToStores(target.ids);
  const master = await readMasterSuppliers();
  return NextResponse.json({
    suppliers: master.length,
    stores: target.stores.length,
    storeNames: target.stores.map((s) => s.name),
  });
}
