import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildPRReportWorkbook } from "@/lib/excelExport";
import { parseQuery, filterPRs, filterNote } from "@/lib/reportFilter";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await readDB();
  const q = parseQuery(req.url);
  const prs = filterPRs(db.purchaseRequests, q);

  const wb = buildPRReportWorkbook(prs, db.meta.business, filterNote(q));
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Purchase-Request-Report.xlsx"`,
    },
  });
}
