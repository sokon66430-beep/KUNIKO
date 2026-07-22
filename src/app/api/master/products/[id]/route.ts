import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { mutateMaster, applyMasterFields } from "@/lib/master";
import { resolveSupplier } from "@/lib/supplierLink";
import { readDB, mutateDB } from "@/lib/db";
import { readSystem } from "@/lib/system";
import { validateSellingUnits } from "@/lib/sellingUnits";
import type { Product } from "@/lib/types";

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

  // Push the shared fields straight to every store's copy, so a rename / price /
  // category change in Master Data shows through everywhere immediately —
  // receiving, the till, inventory — without waiting for a full Sync. Only the
  // master-owned fields are copied (see applyMasterFields); each store keeps its
  // own stock, reorder level and shelf location. A store that doesn't stock this
  // product yet is simply skipped — adding new products is still the Sync's job.
  try {
    const master = result as Product;
    const sys = await readSystem();
    for (const store of sys.stores) {
      await mutateDB((db) => {
        const sp = db.products.find((p) => p.id === params.id);
        if (sp) applyMasterFields(sp, master);
      }, store.id);
    }
  } catch {
    /* best-effort — the master edit already saved; a Sync would reconcile stores */
  }

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
