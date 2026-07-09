import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildPOWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const po = db.purchaseOrders.find((p) => p.id === params.id);
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  const wb = buildPOWorkbook(po, db.meta.business);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.poNo}.xlsx"`,
    },
  });
}
