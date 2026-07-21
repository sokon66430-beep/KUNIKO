import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { mutateMaster } from "@/lib/master";
import { resolveSupplier } from "@/lib/supplierLink";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

const NUMERIC = new Set(["cost", "price", "stock", "reorderLevel", "shelfLifeDays"]);
const STRING_FIELDS = new Set([
  "sku", "subGroupCode", "catCode", "name", "nameKh", "ranking", "groupCode",
  "category", "supplier", "supplierCode", "unit", "barcode", "gondola", "shelf", "image",
]);
// Booleans need their own bucket — they'd be dropped by the string/number rules.
const BOOLEAN_FIELDS = new Set(["showOnPos"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await masterDataFor(session.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // Resolve supplier against the owner's current store (suppliers are per-store).
  if ("supplier" in body || "supplierCode" in body) {
    const db = await readDB(session.storeId);
    const sup = resolveSupplier(db.suppliers, body.supplier, body.supplierCode);
    if (sup.status === "ok") {
      body.supplier = sup.name;
      body.supplierCode = sup.code;
    } else if (sup.status === "none") {
      body.supplier = "—";
      body.supplierCode = undefined;
    }
  }

  const result = await mutateMaster((products) => {
    const product = products.find((p) => p.id === params.id);
    if (!product) return null;
    for (const [key, value] of Object.entries(body)) {
      if (key === "id") continue;
      if (NUMERIC.has(key)) (product as any)[key] = Math.max(0, Number(value) || 0);
      else if (BOOLEAN_FIELDS.has(key)) (product as any)[key] = Boolean(value);
      else if (STRING_FIELDS.has(key)) (product as any)[key] = value || undefined;
      else if (key === "locations" && Array.isArray(value)) (product as any).locations = value;
    }
    return product;
  });

  if (!result) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !(await masterDataFor(session.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const ok = await mutateMaster((products) => {
    const idx = products.findIndex((p) => p.id === params.id);
    if (idx === -1) return false;
    products.splice(idx, 1);
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
