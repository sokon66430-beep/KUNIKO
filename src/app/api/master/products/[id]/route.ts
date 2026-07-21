import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { mutateMaster } from "@/lib/master";
import { resolveSupplier } from "@/lib/supplierLink";
import { readDB } from "@/lib/db";
import { validateSellingUnits } from "@/lib/sellingUnits";

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
    // Packaging levels are validated as a set and each gets its own product code
    // off the base code — codes are made unique across the whole master catalogue
    // here, then pushed to every store on sync. Handled before the field loop so
    // it can't fall through the plain string/number rules.
    if ("sellingUnits" in body) {
      const baseSku = (typeof body.sku === "string" && body.sku.trim()) || product.sku;
      const parsed = validateSellingUnits(body.sellingUnits, product.id, products, baseSku);
      if (!parsed.ok) return { error: parsed.error };
      product.sellingUnits = parsed.value.length ? parsed.value : undefined;
      delete body.sellingUnits;
    }
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
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
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
