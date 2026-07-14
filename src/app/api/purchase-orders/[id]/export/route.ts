import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildPOWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const po = db.purchaseOrders.find((p) => p.id === params.id);
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  // Tax follows the PO's supplier (10% by default, 0 for a tax-free supplier).
  const supplier = db.suppliers.find((s) => s.name === po.supplier);
  const vatRate = supplier ? (supplier.taxPct ?? 10) / 100 : db.meta.business.vatRate ?? 0.1;
  const wb = buildPOWorkbook(po, db.meta.business, vatRate);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.poNo}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
