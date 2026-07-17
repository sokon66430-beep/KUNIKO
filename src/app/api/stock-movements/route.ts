import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/stock-movements?from=ISO&to=ISO&productId=&recipeId=&type=&limit=
//
// The ledger of stock that left for a reason other than being scanned at the
// till — today, ingredients consumed by a recipe. Newest first.
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const productId = url.searchParams.get("productId");
  const recipeId = url.searchParams.get("recipeId");
  const type = url.searchParams.get("type");
  const limit = Number(url.searchParams.get("limit")) || 5000;

  let list = [...db.stockMovements];
  if (from) list = list.filter((m) => m.at >= from);
  if (to) list = list.filter((m) => m.at <= to);
  if (productId && productId !== "All") list = list.filter((m) => m.productId === productId);
  if (recipeId && recipeId !== "All") list = list.filter((m) => m.recipeId === recipeId);
  if (type && type !== "All") list = list.filter((m) => m.type === type);

  list.sort((a, b) => (a.at < b.at ? 1 : -1));
  return NextResponse.json(list.slice(0, limit));
}
