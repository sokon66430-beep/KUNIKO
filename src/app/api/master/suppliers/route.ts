import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMasterSuppliers, mutateMasterSuppliers, propagateSuppliersToStores } from "@/lib/master";
import type { Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const s = await getSession();
  return s && s.role === "owner" ? s : null;
}

// The master supplier list — the single place suppliers are controlled.
export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const list = (await readMasterSuppliers()).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(list);
}

// Add a supplier to the master and mirror it into every store immediately.
export async function POST(req: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Supplier name is required" }, { status: 400 });

  const result = await mutateMasterSuppliers((suppliers) => {
    let code = String(body.code || "").trim();
    if (!code) {
      const maxNum = suppliers.reduce((m, s) => {
        const match = /^SUP0*(\d+)$/.exec(s.code);
        return match ? Math.max(m, parseInt(match[1], 10)) : m;
      }, 0);
      code = `SUP${String(maxNum + 1).padStart(4, "0")}`;
    }
    if (suppliers.some((s) => s.code === code)) return { error: `Supplier code "${code}" already exists` };
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
    suppliers.push(supplier);
    return { supplier };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  await propagateSuppliersToStores();
  return NextResponse.json(result.supplier, { status: 201 });
}
