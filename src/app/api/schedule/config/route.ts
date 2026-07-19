import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { Station, Position } from "@/lib/types";

export const dynamic = "force-dynamic";

// Customizable station + position lists. The page sends the full replacement
// list; we keep stable ids for rows that already existed (matched by id) and
// mint ids for new names, so roster cells that reference a station don't break.

function reconcile<T extends { id: string; name: string }>(
  incoming: any[],
  existing: T[],
  prefix: string,
  nextNum: () => number,
): T[] {
  const out: T[] = [];
  for (const raw of incoming) {
    const name = String(raw?.name || "").trim().slice(0, 40);
    if (!name) continue;
    const id = raw?.id && existing.some((e) => e.id === raw.id) ? String(raw.id) : `${prefix}-${nextNum()}`;
    out.push({ id, name } as T);
  }
  return out;
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const result = await mutateDB((db) => {
    if (Array.isArray(body.stations)) {
      let n = db.stations.reduce((m, x) => Math.max(m, Number(x.id.split("-")[1]) || 0), 0);
      db.stations = reconcile<Station>(body.stations, db.stations, "STN", () => ++n);
    }
    if (Array.isArray(body.positions)) {
      let n = db.positions.reduce((m, x) => Math.max(m, Number(x.id.split("-")[1]) || 0), 0);
      db.positions = reconcile<Position>(body.positions, db.positions, "POS", () => ++n);
    }
    return { stations: db.stations, positions: db.positions };
  });
  return NextResponse.json(result);
}
