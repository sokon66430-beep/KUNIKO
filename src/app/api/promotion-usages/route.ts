import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/promotion-usages?from=ISO&to=ISO&promotionId=&productId=&limit=
//
// Every time a deal fired, newest first. Each row snapshots the promotion's
// name and terms as they were at the till, so editing or deleting a promotion
// later can't rewrite what the reports say happened.
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const promotionId = url.searchParams.get("promotionId");
  const productId = url.searchParams.get("productId");
  const limit = Number(url.searchParams.get("limit")) || 5000;

  let list = [...db.promotionUsages];
  if (from) list = list.filter((u) => u.at >= from);
  if (to) list = list.filter((u) => u.at <= to);
  if (promotionId && promotionId !== "All") list = list.filter((u) => u.promotionId === promotionId);
  if (productId && productId !== "All") {
    list = list.filter((u) => u.items.some((i) => i.productId === productId));
  }

  list.sort((a, b) => (a.at < b.at ? 1 : -1));
  return NextResponse.json(list.slice(0, limit));
}
