import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveSupplier, supplierNotInSystem } from "@/lib/supplierLink";

export const dynamic = "force-dynamic";

const NUMERIC = new Set(["cost", "price", "stock", "reorderLevel", "shelfLifeDays"]);
// Explicit allow-list rather than `key in product` — optional fields like
// supplierCode are dropped by JSON.stringify when undefined, so a product
// that has never had a supplier linked genuinely lacks that key at runtime,
// and `in` would wrongly refuse to ever set it for that record.
const STRING_FIELDS = new Set(["sku", "subGroupCode", "catCode", "name", "nameKh", "ranking", "groupCode", "category", "supplier", "supplierCode", "unit", "barcode", "gondola", "shelf"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const result = await mutateDB((db) => {
    const product = db.products.find((p) => p.id === params.id);
    if (!product) return null;

    // If this edit touches the supplier, it must resolve to a real supplier.
    // Legacy records whose supplier is unchanged pass through (grandfathered),
    // so editing an unrelated field never gets blocked.
    if ("supplier" in body || "supplierCode" in body) {
      const sup = resolveSupplier(db.suppliers, body.supplier, body.supplierCode);
      if (sup.status === "ok") {
        body.supplier = sup.name;
        body.supplierCode = sup.code;
      } else if (sup.status === "none") {
        body.supplier = "—";
        body.supplierCode = undefined;
      } else {
        const unchanged =
          (product.supplier || "") === (body.supplier || "") &&
          (product.supplierCode || "") === (body.supplierCode || "");
        if (!unchanged) return { error: supplierNotInSystem(sup.input) };
      }
    }

    const prevStock = product.stock;
    for (const [key, value] of Object.entries(body)) {
      if (key === "id") continue;
      if (NUMERIC.has(key)) {
        (product as any)[key] = Math.max(0, Number(value) || 0);
      } else if (STRING_FIELDS.has(key)) {
        (product as any)[key] = value || undefined;
      }
    }
    const changedKeys = Object.keys(body).filter((k) => k !== "id");
    if (changedKeys.length === 1 && changedKeys[0] === "stock") {
      // Inventory "Restock" button — a manual stock adjustment.
      const delta = product.stock - prevStock;
      logAudit(db, {
        actor: "Admin",
        action: "Restocked",
        entityType: "Stock",
        entity: product.name,
        detail: `${delta >= 0 ? "+" : ""}${delta} → ${product.stock}`,
      });
    } else {
      logAudit(db, { actor: "Admin", action: "Updated", entityType: "Product", entity: product.name });
    }
    return product;
  });

  if (!result) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = await mutateDB((db) => {
    const idx = db.products.findIndex((p) => p.id === params.id);
    if (idx === -1) return false;
    const [removed] = db.products.splice(idx, 1);
    logAudit(db, { actor: "Admin", action: "Deleted", entityType: "Product", entity: removed.name });
    return true;
  });

  if (!ok) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
