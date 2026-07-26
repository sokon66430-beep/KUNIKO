import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { profitFor } from "@/lib/caps";
import { readDB } from "@/lib/db";
import { buildProductsWorkbook } from "@/lib/excelExport";
import { buildPdf, type Col } from "@/lib/reportExport";
import { formatLocations } from "@/lib/location";

export const dynamic = "force-dynamic";

// ?format=xlsx (default) | pdf · ?unlinked=1 filters to supplier-less products.
export async function GET(req: Request) {
  // Cost is the whole margin book. Without this check anyone with a till login
  // could type this URL and download every product's cost as a spreadsheet,
  // which walks straight around the profit capability the owner sets on
  // /permissions. Non-privileged roles still get the export — just no Cost column.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const showCost = await profitFor(session.role);
  const db = await readDB();
  const url = new URL(req.url);
  const unlinked = url.searchParams.get("unlinked") === "1";
  const format = url.searchParams.get("format") || "xlsx";
  const products = unlinked ? db.products.filter((p) => !p.supplierCode) : db.products;
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const cols: Col[] = [
      { header: "Item ID", get: (p: any) => p.sku },
      { header: "Barcode", get: (p: any) => p.barcode || "" },
      { header: "Product Name", get: (p: any) => p.name, width: 2 },
      { header: "Category", get: (p: any) => p.category || "" },
      { header: "Location(s)", get: (p: any) => formatLocations(p) },
      { header: "Unit", get: (p: any) => p.unit || "" },
      { header: "Supplier", get: (p: any) => (p.supplier && p.supplier !== "—" ? p.supplier : ""), width: 1.4 },
      // Pre-formatted so buildPdf doesn't add a (meaningless) unit-cost total row.
      ...(showCost ? [{ header: "Cost", get: (p: any) => `$${Number(p.cost || 0).toFixed(2)}` }] : []),
      { header: "Price", get: (p: any) => `$${Number(p.price || 0).toFixed(2)}` },
      { header: "Stock", get: (p: any) => p.stock, num: true },
    ];
    const bytes = await buildPdf({
      title: "Product Master",
      filename: `products-${stamp}`,
      subtitle: `${db.meta.business.name} · ${db.meta.business.branch}   ·   ${products.length} products`,
      cols,
      rows: products,
    });
    return new NextResponse(bytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="products-${stamp}.pdf"`,
      },
    });
  }

  const wb = buildProductsWorkbook(products, showCost);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="products${unlinked ? "-unlinked" : ""}-${stamp}.xlsx"`,
    },
  });
}
