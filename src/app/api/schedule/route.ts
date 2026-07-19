import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// The Job Schedule read hub — everything the workforce screens need in one call:
// the shift templates (1/2/3), the customizable station + position lists, the
// store's staff roster, and the roster grid entries.
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const db = await readDB();
  // Never leak PIN hashes — expose only whether a staff member has a PIN set
  // (so the UI can show who can sign into the till).
  const employees = db.scheduleEmployees.map(({ pinHash, ...e }) => ({ ...e, hasPin: !!pinHash }));
  return NextResponse.json({
    shiftTemplates: db.shiftTemplates,
    stations: db.stations,
    positions: db.positions,
    employees,
    roster: db.rosterEntries,
  });
}
