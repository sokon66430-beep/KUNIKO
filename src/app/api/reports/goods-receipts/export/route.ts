import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildGRNReportWorkbook } from "@/lib/excelExport";
import { parseQuery, filterGRNs, filterNote } from "@/lib/reportFilter";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await readDB();
  const q = parseQuery(req.url);
  const grns = filterGRNs(db.goodsReceipts, q);

  const wb = buildGRNReportWorkbook(grns, db.meta.business, filterNote(q));
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Receiving-Report.xlsx"`,
    },
  });
}
