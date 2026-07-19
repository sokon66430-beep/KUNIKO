import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { ShiftTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

// Shift Master — the Excel's 1 / 2 / 3. Admin can edit each shift's name and
// check-in / check-out times, mark a night shift as overnight, or add/retire a
// shift. The `code` shown in the roster grid is derived from position order.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(body: any): Partial<ShiftTemplate> {
  const out: Partial<ShiftTemplate> = {};
  if (typeof body.name === "string") out.name = body.name.trim().slice(0, 40);
  if (typeof body.startTime === "string" && HHMM.test(body.startTime)) out.startTime = body.startTime;
  if (typeof body.endTime === "string" && HHMM.test(body.endTime)) out.endTime = body.endTime;
  if ("overnight" in body) out.overnight = !!body.overnight;
  if (typeof body.color === "string") out.color = body.color;
  if (body.status === "active" || body.status === "inactive") out.status = body.status;
  return out;
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const patch = clean(await req.json().catch(() => ({})));
  if (!patch.name || !patch.startTime || !patch.endTime) {
    return NextResponse.json({ error: "Name and valid check-in / check-out times are required" }, { status: 400 });
  }
  const created = await mutateDB((db) => {
    const nextCode = db.shiftTemplates.reduce((m, t) => Math.max(m, t.code), 0) + 1;
    const t: ShiftTemplate = {
      id: `SHT-${Date.now().toString(36).toUpperCase()}`,
      name: patch.name!,
      code: nextCode,
      startTime: patch.startTime!,
      endTime: patch.endTime!,
      overnight: patch.overnight,
      color: patch.color || "slate",
      status: "active",
    };
    db.shiftTemplates.push(t);
    return t;
  });
  return NextResponse.json(created);
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const patch = clean(body);
  const updated = await mutateDB((db) => {
    const t = db.shiftTemplates.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    return t;
  });
  if (!updated) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const ok = await mutateDB((db) => {
    const i = db.shiftTemplates.findIndex((x) => x.id === id);
    if (i < 0) return false;
    db.shiftTemplates.splice(i, 1);
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
