import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await readDB();
  const p = new URL(req.url).searchParams;
  const entityType = p.get("entityType");
  const actor = p.get("actor");
  const from = p.get("from");
  const to = p.get("to");

  const list = db.auditLog
    .filter((e) => !entityType || entityType === "All" || e.entityType === entityType)
    .filter((e) => !actor || actor === "All" || e.actor === actor)
    .filter((e) => {
      const day = e.at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return NextResponse.json(list);
}
