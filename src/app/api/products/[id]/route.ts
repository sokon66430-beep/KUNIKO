import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const NUMERIC = new Set(["cost", "price", "stock", "reorderLevel"]);
// Explicit allow-list rather than `key in product` — optional fields like
// supplierCode are dropped by JSON.stringify when undefined, so a product
// that has never had a supplier linked genuinely lacks that key at runtime,
// and `in` would wrongly refuse to ever set it for that record.
const STRING_FIELDS = new Set(["sku", "subGroupCode", "catCode", "name", "category", "supplier", "supplierCode", "unit", "barcode"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const result = await mutateDB((db) => {
    const product = db.products.find((p) => p.id === params.id);
    if (!product) return null;
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
