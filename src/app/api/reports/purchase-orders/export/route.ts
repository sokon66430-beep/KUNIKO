import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildPOReportWorkbook } from "@/lib/excelExport";
import { parseQuery, filterPOs, filterNote } from "@/lib/reportFilter";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await readDB();
  const q = parseQuery(req.url);
  const pos = filterPOs(db.purchaseOrders, q);

  const wb = buildPOReportWorkbook(pos, db.meta.business, filterNote(q));
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Purchase-Order-Report.xlsx"`,
    },
  });
}
