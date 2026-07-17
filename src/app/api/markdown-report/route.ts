import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { profitFor } from "@/lib/caps";
import { markdownReportRows } from "@/lib/markdownReport";

export const dynamic = "force-dynamic";

// GET /api/markdown-report — every markdown label with what it actually sold.
//
// Computed here rather than in the page so the screen and the Excel/PDF/CSV
// exports can never disagree about the numbers.
export async function GET() {
  const db = await readDB();
  const rows = markdownReportRows(db.markdowns, db.sales);

  const session = await getSession();
  if (session && (await profitFor(session.role))) return NextResponse.json(rows);

  // Cost and profit are Procurement + owner only — same rule as /api/sales.
  // Revenue and the discount given stay: they're shelf facts, not margin.
  return NextResponse.json(rows.map((r) => ({ ...r, cost: 0, profit: 0 })));
}
