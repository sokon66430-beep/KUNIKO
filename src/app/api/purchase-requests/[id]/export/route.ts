import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildPRWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const pr = db.purchaseRequests.find((r) => r.id === params.id);
  if (!pr) return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });

  const wb = buildPRWorkbook(pr, db.meta.business);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${pr.prNo}.xlsx"`,
    },
  });
}
