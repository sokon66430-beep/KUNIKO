import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { generateItemId } from "@/lib/itemId";
import { resolveSupplier, supplierNotInSystem } from "@/lib/supplierLink";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  return NextResponse.json(db.products);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.name || body?.price == null) {
    return NextResponse.json({ error: "name and price are required" }, { status: 400 });
  }

  const created = await mutateDB((db) => {
    // A supplier can only be attached if it already exists in the system.
    const sup = resolveSupplier(db.suppliers, body.supplier, body.supplierCode);
    if (sup.status === "unknown") return { error: supplierNotInSystem(sup.input) };

    const idNum = db.products.reduce((max, p) => Math.max(max, parseInt(p.id.slice(1)) || 0), 0) + 1;
    // Item ID: keep an explicit one if given, else auto-generate a unique
    // 8-digit code from the sub-group + category codes.
    const existing = new Set(db.products.map((p) => p.sku));
    const sku = body.sku?.trim() || generateItemId(body.subGroupCode, body.catCode, existing);
    const product: Product = {
      id: `p${idNum.toString().padStart(3, "0")}`,
      sku,
      subGroupCode: body.subGroupCode?.trim() || undefined,
      catCode: body.catCode?.trim() || undefined,
      name: body.name.trim(),
      nameKh: body.nameKh?.trim() || undefined,
      ranking: ["A", "B", "C", "D"].includes(body.ranking) ? body.ranking : "A",
      shelfLifeDays: Math.max(0, Number(body.shelfLifeDays) || 0) || undefined,
      groupCode: body.groupCode?.trim().toUpperCase() || undefined,
      category: body.category?.trim() || "Other",
      supplier: sup.status === "ok" ? sup.name : "—",
      supplierCode: sup.status === "ok" ? sup.code : undefined,
      unit: body.unit?.trim() || "pcs",
      cost: Math.max(0, Number(body.cost) || 0),
      price: Math.max(0, Number(body.price) || 0),
      stock: Math.max(0, Number(body.stock) || 0),
      reorderLevel: Math.max(0, Number(body.reorderLevel) || 0),
      barcode: body.barcode?.trim() || undefined,
      gondola: body.gondola?.trim() || undefined,
      shelf: body.shelf?.trim() || undefined,
    };
    db.products.push(product);
    logAudit(db, { actor: "Admin", action: "Created", entityType: "Product", entity: product.name, detail: product.barcode || product.sku });
    return { product };
  });

  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  return NextResponse.json(created.product, { status: 201 });
}
