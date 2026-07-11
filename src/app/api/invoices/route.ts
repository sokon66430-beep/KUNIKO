import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// Accounting inbox: every receipt that carries a scanned invoice, newest first.
export async function GET() {
  const db = await readDB();
  const list = db.goodsReceipts
    .filter((g) => g.invoice)
    .map((g) => ({
      grnId: g.id,
      grnNo: g.grnNo,
      poNo: g.poNo,
      supplier: g.supplier,
      receivedBy: g.receivedBy,
      createdAt: g.createdAt,
      items: g.items.length,
      units: g.items.reduce((s, i) => s + i.qtyReceived, 0),
      invoice: g.invoice!,
    }))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json(list);
}
