import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { readMaster } from "@/lib/master";
import { buildProductsWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

// Export the master catalog as Excel (same columns as the product import
// template, so it round-trips: export → edit → re-import).
export async function GET() {
  const session = await getSession();
  if (!session || !(await masterDataFor(session.role))) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });

  const products = await readMaster();
  const wb = buildProductsWorkbook(products);
  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="master-catalog-${stamp}.xlsx"`,
    },
  });
}
