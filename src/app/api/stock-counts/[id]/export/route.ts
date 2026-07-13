import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStockCountWorkbook } from "@/lib/excelExport";
import { buildCsv, buildPdf, type Col } from "@/lib/reportExport";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";

export const dynamic = "force-dynamic";

// ?format=xlsx (default) | csv | pdf
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const count = db.stockCounts.find((c) => c.id === params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });

  // Cost / Sell Price / Total are money figures — same rule as everywhere else,
  // only the owner and procurement see them.
  const session = await getSession();
  const showValue = !!session && canSeeProfit(session.role);

  const format = new URL(req.url).searchParams.get("format") || "xlsx";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${count.countNo}-${stamp}`;

  if (format === "csv" || format === "pdf") {
    const counted = new Map(count.items.map((i) => [i.productId, i.countedQty]));
    const rows = db.products.map((p, i) => {
      const cq = counted.has(p.id) ? (counted.get(p.id) as number) : null;
      return {
        no: i + 1,
        sku: p.sku,
        barcode: p.barcode || "",
        name: p.name,
        category: p.category || "",
        unit: p.unit || "",
        systemQty: p.stock,
        countedQty: cq ?? "",
        variance: cq != null ? cq - p.stock : "",
        cost: p.cost,
        price: p.price,
        total: cq != null ? Math.round(cq * p.cost * 100) / 100 : "",
      };
    });
    const cols: Col[] = [
      { header: "No", get: (r: any) => r.no, num: true },
      { header: "Item Code", get: (r: any) => r.sku },
      { header: "Barcode", get: (r: any) => r.barcode },
      { header: "Product Name", get: (r: any) => r.name, width: 2 },
      { header: "Category", get: (r: any) => r.category },
      { header: "Unit", get: (r: any) => r.unit },
      { header: "System Qty", get: (r: any) => r.systemQty, num: true },
      { header: "Counted Qty", get: (r: any) => r.countedQty, num: true },
      { header: "Variance", get: (r: any) => r.variance, num: true },
      ...(showValue
        ? [
            { header: "Cost", get: (r: any) => r.cost, money: true },
            { header: "Sell Price", get: (r: any) => r.price, money: true },
            { header: "Total (Cost)", get: (r: any) => r.total, money: true },
          ]
        : []),
    ];

    if (format === "csv") {
      return new NextResponse(buildCsv(cols, rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      });
    }

    const bytes = await buildPdf({
      title: "Stock Count Sheet",
      filename,
      subtitle: `${db.meta.business.name} · ${db.meta.business.branch}   ·   ${count.countNo} · started by ${count.countedBy || "—"}`,
      cols,
      rows,
    });
    return new NextResponse(bytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      },
    });
  }

  const wb = buildStockCountWorkbook(count, db.products, db.meta.business, showValue);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}
