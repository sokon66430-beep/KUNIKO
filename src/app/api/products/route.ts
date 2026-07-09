import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { generateItemId } from "@/lib/itemId";
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
      category: body.category?.trim() || "Other",
      supplier: body.supplier?.trim() || "—",
      supplierCode: body.supplierCode?.trim() || undefined,
      unit: body.unit?.trim() || "pcs",
      cost: Math.max(0, Number(body.cost) || 0),
      price: Math.max(0, Number(body.price) || 0),
      stock: Math.max(0, Number(body.stock) || 0),
      reorderLevel: Math.max(0, Number(body.reorderLevel) || 0),
      barcode: body.barcode?.trim() || undefined,
    };
    db.products.push(product);
    logAudit(db, { actor: "Admin", action: "Created", entityType: "Product", entity: product.name, detail: product.barcode || product.sku });
    return product;
  });

  return NextResponse.json(created, { status: 201 });
}
