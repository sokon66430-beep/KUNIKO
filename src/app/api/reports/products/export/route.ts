import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildStats, type RangeKey } from "@/lib/analytics";
import { getSession } from "@/lib/session";
import { profitFor } from "@/lib/caps";
import { buildProductSalesWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

const VALID: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d"];
const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

// Product Sales report → Excel. Same figures the /reports screen shows (both
// go through buildStats), so the export reconciles to the page. Cost/profit are
// gated by the profit permission; VAT / revenue / units always show.
export async function GET(req: Request) {
  const db = await readDB();
  const params = new URL(req.url).searchParams;
  const raw = params.get("range") as RangeKey | null;
  const range: RangeKey = raw && VALID.includes(raw) ? raw : "30d";
  const valid = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const customDay = valid(params.get("date"));
  const customTo = valid(params.get("to"));

  const stats = buildStats(db, range, customDay, customTo);

  const session = await getSession();
  const showProfit = !session ? false : await profitFor(session.role);

  const note = customDay ? (customTo ? `${customDay} → ${customTo}` : customDay) : RANGE_LABEL[range];
  const rows = stats.productReport.map((p) => ({
    name: p.name,
    sku: p.sku,
    qty: p.qty,
    revenue: p.revenue,
    vat: p.vat,
    // Blank out the sensitive columns for roles without profit access.
    cost: showProfit ? p.cost : 0,
    profit: showProfit ? p.profit : 0,
    margin: showProfit ? p.margin : 0,
  }));

  const wb = buildProductSalesWorkbook(rows, db.meta.business, note, showProfit);
  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="product-sales-${stamp}.xlsx"`,
    },
  });
}
