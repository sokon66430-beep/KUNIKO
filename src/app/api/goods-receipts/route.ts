import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  const list = [...db.goodsReceipts].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return NextResponse.json(list);
}
