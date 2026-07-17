import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterRecipes } from "@/lib/master";

export const dynamic = "force-dynamic";

// GET /api/master/recipes — the central recipe list, newest first.
//
// Read-only on purpose: recipes are written on /recipes (which store leadership
// can reach), and that route already writes to this master and mirrors out.
// This is the owner's view of what every store is running.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const master = await readMasterRecipes();
  const items = [...master.items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json(items);
}
