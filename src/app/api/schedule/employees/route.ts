import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { canManageStaff } from "@/lib/access";
import { getSession } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import type { ScheduleEmployee } from "@/lib/types";

export const dynamic = "force-dynamic";

// A till PIN is exactly 6 digits. "" clears it (removes till access); undefined
// leaves it unchanged. Returns { hash } to set, { clear:true } to remove, or null.
function pinChange(body: any): { hash?: string; clear?: boolean } | null {
  if (!("pin" in body)) return null;
  const raw = String(body.pin ?? "").trim();
  if (raw === "") return { clear: true };
  if (!/^\d{6}$/.test(raw)) return null; // invalid → ignore, don't half-set
  return { hash: hashPassword(raw) };
}

// The store's staff roster (Job Schedule employees). Most crew have no POS login,
// so this is a dedicated list — name, phone, position, station, default shift —
// optionally linked to a login account (userId) for attendance later.

function clean(body: any): Partial<ScheduleEmployee> {
  const out: Partial<ScheduleEmployee> = {};
  if (typeof body.name === "string") out.name = body.name.trim().slice(0, 80);
  if (typeof body.phone === "string") out.phone = body.phone.trim().slice(0, 30) || undefined;
  if ("positionId" in body) out.positionId = body.positionId ? String(body.positionId) : undefined;
  if ("stationId" in body) out.stationId = body.stationId ? String(body.stationId) : undefined;
  if ("defaultShiftId" in body) out.defaultShiftId = body.defaultShiftId ? String(body.defaultShiftId) : undefined;
  if ("userId" in body) out.userId = body.userId ? String(body.userId) : undefined;
  if ("active" in body) out.active = body.active !== false;
  return out;
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "Only a manager can change the staff roster" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const patch = clean(body);
  if (!patch.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const pin = pinChange(body);

  const created = await mutateDB((db) => {
    const n = db.meta.nextScheduleEmployee ?? 1;
    db.meta.nextScheduleEmployee = n + 1;
    const emp: ScheduleEmployee = {
      id: `EMP-${String(n).padStart(6, "0")}`,
      name: patch.name!,
      phone: patch.phone,
      positionId: patch.positionId,
      stationId: patch.stationId,
      defaultShiftId: patch.defaultShiftId,
      userId: patch.userId,
      pinHash: pin?.hash,
      active: true,
      createdBy: s.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.scheduleEmployees.push(emp);
    return emp;
  });
  return NextResponse.json(safe(created));
}

// Strip the PIN hash before returning an employee to the client.
function safe(e: ScheduleEmployee) {
  const { pinHash, ...rest } = e;
  return { ...rest, hasPin: !!pinHash };
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "Only a manager can change the staff roster" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const patch = clean(body);
  const pin = pinChange(body);

  const updated = await mutateDB((db) => {
    const emp = db.scheduleEmployees.find((e) => e.id === id);
    if (!emp) return null;
    Object.assign(emp, patch);
    if (pin?.clear) delete emp.pinHash;
    else if (pin?.hash) emp.pinHash = pin.hash;
    emp.updatedAt = new Date().toISOString();
    return emp;
  });
  if (!updated) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  return NextResponse.json(safe(updated));
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "Only a manager can change the staff roster" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const ok = await mutateDB((db) => {
    const i = db.scheduleEmployees.findIndex((e) => e.id === id);
    if (i < 0) return false;
    db.scheduleEmployees.splice(i, 1);
    // Drop this person's roster cells too, so the grid never references a ghost.
    db.rosterEntries = db.rosterEntries.filter((r) => r.employeeId !== id);
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
