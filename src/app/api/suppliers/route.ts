import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  const list = [...db.suppliers].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const actor = await currentActor();
  const body = await req.json();
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "Supplier name is required" }, { status: 400 });

  const result = await mutateDB((db) => {
    let code = body.code?.trim();
    if (!code) {
      // Derive from the highest existing SUP#### so deletions can't cause a
      // collision, and match the master's dash-free "SUP0184" format.
      const maxNum = db.suppliers.reduce((m, s) => {
        const match = /^SUP0*(\d+)$/.exec(s.code);
        return match ? Math.max(m, parseInt(match[1], 10)) : m;
      }, 0);
      code = `SUP${String(maxNum + 1).padStart(4, "0")}`;
    }
    if (db.suppliers.some((s) => s.code === code)) {
      return { error: `Supplier code "${code}" already exists` };
    }
    const supplier: Supplier = {
      code,
      name,
      address: body.address?.trim() || undefined,
      city: body.city?.trim() || undefined,
      country: body.country?.trim() || undefined,
      minOrderAmount: Number(body.minOrderAmount) || 0,
      leadTime: Number(body.leadTime) || 0,
      deliverySchedule: body.deliverySchedule?.trim() || undefined,
      contactPerson: body.contactPerson?.trim() || undefined,
      phone: body.phone?.trim() || undefined,
      email: body.email?.trim() || undefined,
      taxId: body.taxId?.trim() || undefined,
      taxPct: Math.max(0, Number(body.taxPct) || 0),
    };
    db.suppliers.push(supplier);
    logAudit(db, { actor, action: "Created", entityType: "Supplier", entity: `${supplier.name} (${supplier.code})` });
    return { supplier };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.supplier, { status: 201 });
}
