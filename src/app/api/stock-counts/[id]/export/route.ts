import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStockCountWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const count = db.stockCounts.find((c) => c.id === params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });

  const wb = buildStockCountWorkbook(count, db.products, db.meta.business);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${count.countNo}.xlsx"`,
    },
  });
}
