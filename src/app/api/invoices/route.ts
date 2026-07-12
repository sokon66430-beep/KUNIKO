import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Accounting inbox: every receipt that carries a scanned invoice, newest first.
// Only Accounting (and the owner) may see invoices.
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (s.role !== "accountant" && s.role !== "owner") {
    return NextResponse.json({ error: "Only Accounting can view invoices" }, { status: 403 });
  }
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
