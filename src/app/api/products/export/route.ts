import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildProductsWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await readDB();
  const unlinked = new URL(req.url).searchParams.get("unlinked") === "1";
  const products = unlinked ? db.products.filter((p) => !p.supplierCode) : db.products;

  const wb = buildProductsWorkbook(products);
  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="products${unlinked ? "-unlinked" : ""}-${stamp}.xlsx"`,
    },
  });
}
