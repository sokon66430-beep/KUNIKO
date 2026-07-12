import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildWriteOffWorkbook, WRITE_OFF_COLUMNS } from "@/lib/excelExport";
import { buildPdf } from "@/lib/reportExport";
import type { WriteOff } from "@/lib/types";

export const dynamic = "force-dynamic";

function filtered(list: WriteOff[], url: URL): { rows: WriteOff[]; note: string } {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const reason = url.searchParams.get("reason");
  let rows = [...list];
  if (from) rows = rows.filter((w) => w.createdAt >= from);
  if (to) rows = rows.filter((w) => w.createdAt <= to);
  if (reason && reason !== "All") rows = rows.filter((w) => w.reason === reason);
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const note = url.searchParams.get("note") || "All records";
  return { rows, note };
}

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const { rows, note } = filtered(db.writeOffs, url);
  const fmt = url.searchParams.get("format");
  const format = fmt === "csv" || fmt === "pdf" ? fmt : "xlsx";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const bytes = await buildPdf({
      title: "Write-Off Report",
      filename: `write-offs-${stamp}`,
      subtitle: `${db.meta.business?.name || "Stookii"}   |   ${note}`,
      rows,
      cols: WRITE_OFF_COLUMNS.map((c) => ({ header: c.header, get: c.get, num: c.header === "Quantity" })),
    });
    return new NextResponse(bytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="write-offs-${stamp}.pdf"`,
      },
    });
  }

  if (format === "csv") {
    const header = ["No", ...WRITE_OFF_COLUMNS.map((c) => csvCell(c.header))].join(",");
    const body = rows
      .map((w, i) => [String(i + 1), ...WRITE_OFF_COLUMNS.map((c) => csvCell(c.get(w)))].join(","))
      .join("\n");
    return new NextResponse(`﻿${header}\n${body}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="write-offs-${stamp}.csv"`,
      },
    });
  }

  const wb = buildWriteOffWorkbook(rows, db.meta.business, note);
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="write-offs-${stamp}.xlsx"`,
    },
  });
}
