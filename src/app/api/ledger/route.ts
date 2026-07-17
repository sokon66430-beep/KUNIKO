import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/ledger?productId=&type=&from=&to=&q=&limit=
// The inventory ledger, newest first. `q` matches product name / SKU / barcode
// / reference. Dates compare on the ISO string (from inclusive, to exclusive
// end-of-day handled client-side by passing the next day).
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const type = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = (url.searchParams.get("q") || "").toLowerCase().trim();
  const limit = Math.min(Number(url.searchParams.get("limit")) || 300, 2000);

  let list = db.ledger;
  if (productId) list = list.filter((l) => l.productId === productId);
  if (type && type !== "All") list = list.filter((l) => l.type === type);
  if (from) list = list.filter((l) => l.at >= from);
  if (to) list = list.filter((l) => l.at <= to + "T23:59:59.999Z");
  if (q) {
    list = list.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.sku.toLowerCase().includes(q) ||
        (l.barcode || "").includes(q) ||
        (l.ref || "").toLowerCase().includes(q),
    );
  }
  const total = list.length;
  const rows = [...list].reverse().slice(0, limit);
  return NextResponse.json({ total, rows });
}
