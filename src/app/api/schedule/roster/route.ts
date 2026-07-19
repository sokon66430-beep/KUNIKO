import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canAssignRoster } from "@/lib/access";
import type { RosterEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// Monthly roster assignment. The manager / area manager assigns each person's
// shift per day (or OFF) by hand — no auto-scheduling. One POST carries all the
// cells they changed; each cell is upserted (or cleared) for its employee+date.
//
// cell = { employeeId, date: "YYYY-MM-DD", shiftId?: string, off?: boolean }
//   shiftId set        → works that shift
//   off: true          → day off
//   neither (clear)    → remove the entry (blank cell)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canAssignRoster(s.role)) {
    return NextResponse.json({ error: "Only a manager or area manager can assign the roster." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const cells: any[] = Array.isArray(body.cells) ? body.cells : [];
  if (cells.length === 0) return NextResponse.json({ error: "No cells to save" }, { status: 400 });

  const roster = await mutateDB((db) => {
    const validShift = new Set(db.shiftTemplates.map((t) => t.id));
    const validEmp = new Set(db.scheduleEmployees.map((e) => e.id));
    const now = new Date().toISOString();

    for (const c of cells) {
      const employeeId = String(c?.employeeId || "");
      const date = String(c?.date || "");
      if (!validEmp.has(employeeId) || !ISO_DATE.test(date)) continue;
      const off = c?.off === true;
      const shiftId = !off && c?.shiftId && validShift.has(c.shiftId) ? String(c.shiftId) : undefined;
      const clear = !off && !shiftId;

      const i = db.rosterEntries.findIndex((r) => r.employeeId === employeeId && r.date === date);
      if (clear) {
        if (i >= 0) db.rosterEntries.splice(i, 1);
        continue;
      }
      if (i >= 0) {
        db.rosterEntries[i] = { ...db.rosterEntries[i], shiftId, off: off || undefined, updatedAt: now };
      } else {
        const n = db.meta.nextRosterEntry ?? 1;
        db.meta.nextRosterEntry = n + 1;
        const entry: RosterEntry = {
          id: `RST-${String(n).padStart(6, "0")}`,
          employeeId,
          date,
          shiftId,
          off: off || undefined,
          createdBy: s.name,
          createdAt: now,
          updatedAt: now,
        };
        db.rosterEntries.push(entry);
      }
    }
    return db.rosterEntries;
  });

  return NextResponse.json({ roster });
}
