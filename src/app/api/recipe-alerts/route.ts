import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { ingredientAlerts, stockUnitOf } from "@/lib/recipes";

export const dynamic = "force-dynamic";

// GET /api/recipe-alerts — ingredients an active recipe needs that stock can't
// cover. Computed here rather than on the client so the dashboard doesn't have
// to download the whole catalog to find a handful of rows.
export async function GET() {
  const db = await readDB();
  const alerts = ingredientAlerts(db.recipes, db.products);
  return NextResponse.json({
    recipeCount: db.recipes.filter((r) => r.status === "Active").length,
    negative: alerts.filter((a) => a.level === "negative").length,
    low: alerts.filter((a) => a.level === "low").length,
    items: alerts.slice(0, 8).map((a) => ({
      id: a.product.id,
      name: a.product.name,
      sku: a.product.sku,
      stock: a.product.stock,
      unit: stockUnitOf(a.product),
      reorderLevel: a.product.reorderLevel,
      level: a.level,
      usedBy: a.usedBy,
    })),
  });
}
