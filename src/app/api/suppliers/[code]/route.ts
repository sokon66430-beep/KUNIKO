import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Suppliers are edited/deleted only in Master Data (owner-only), which mirrors
// the change to every store. See /api/master/suppliers/[code].
export async function PATCH() {
  return NextResponse.json({ error: "Suppliers are managed in Master Data." }, { status: 403 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Suppliers are managed in Master Data." }, { status: 403 });
}
