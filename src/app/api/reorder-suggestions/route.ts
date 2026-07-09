import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { suggestedQty } from "@/lib/procurement";

export const dynamic = "force-dynamic";

// Products at or below reorder level, with a suggested order quantity.
export async function GET() {
  const db = await readDB();
  const list = db.products
    // only products with a real Low Stock Alert threshold, at or below it
    .filter((p) => p.reorderLevel > 0 && p.stock <= p.reorderLevel)
    .map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      supplier: p.supplier,
      unit: p.unit,
      cost: p.cost,
      stock: p.stock,
      reorderLevel: p.reorderLevel,
      suggestedQty: suggestedQty(p),
    }))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 60); // cap so auto-fill stays manageable
  return NextResponse.json(list);
}
