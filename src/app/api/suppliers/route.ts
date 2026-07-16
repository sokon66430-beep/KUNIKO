import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// The per-store supplier list (a mirror of the master). Read-only here —
// suppliers are created/edited/deleted only in Master Data (owner-only), which
// pushes the change to every store. See /api/master/suppliers.
export async function GET() {
  const db = await readDB();
  const list = [...db.suppliers].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(list);
}

export async function POST() {
  return NextResponse.json({ error: "Suppliers are managed in Master Data." }, { status: 403 });
}
