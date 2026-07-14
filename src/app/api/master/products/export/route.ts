import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMaster } from "@/lib/master";
import { buildProductsWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

// Export the master catalog as Excel (same columns as the product import
// template, so it round-trips: export → edit → re-import).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

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
