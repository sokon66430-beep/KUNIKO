import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import {
  mutateMasterSuppliers,
  propagateSuppliersToStores,
  propagateSupplierRename,
  removeSupplierFromStores,
  readMaster,
} from "@/lib/master";
import type { Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireMasterAccess() {
  const s = await getSession();
  return s && (await masterDataFor(s.role)) ? s : null;
}

const FIELDS: (keyof Supplier)[] = [
  "name",
  "address",
  "city",
  "country",
  "minOrderAmount",
  "leadTime",
  "deliverySchedule",
  "contactPerson",
  "phone",
  "email",
  "taxId",
  "taxPct",
];

// Edit a master supplier and mirror the change into every store.
export async function PATCH(req: Request, { params }: { params: { code: string } }) {
  if (!(await requireMasterAccess())) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const code = decodeURIComponent(params.code);
  const body = await req.json().catch(() => ({}));

  const result = await mutateMasterSuppliers((suppliers) => {
    const s = suppliers.find((x) => x.code === code);
    if (!s) return { error: "not_found" as const };
    const before = s.name;
    for (const f of FIELDS) {
      if (body[f] === undefined) continue;
      if (f === "minOrderAmount" || f === "leadTime" || f === "taxPct") {
        (s as any)[f] = Math.max(0, Number(body[f]) || 0);
      } else {
        (s as any)[f] = String(body[f]).trim() || undefined;
      }
    }
    if (typeof body.name === "string" && body.name.trim()) s.name = body.name.trim();
    return { supplier: s, renamedFrom: s.name === before ? undefined : before };
  });

  if ("error" in result) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  await propagateSuppliersToStores();

  // Products keep the supplier's NAME as display text next to the code, so a
  // rename has to reach them too. Without this the supplier record says one
  // thing and all 4,000 products still say the old name — which is the drift
  // the supplier master exists to prevent.
  let updatedProducts = 0;
  if (result.renamedFrom) {
    updatedProducts = await propagateSupplierRename(code, result.supplier.name);
  }
  return NextResponse.json({ ...result.supplier, updatedProducts });
}

// Delete a master supplier — blocked while any master product is still linked
// to it (so no product is orphaned), then removed from every store.
export async function DELETE(_req: Request, { params }: { params: { code: string } }) {
  if (!(await requireMasterAccess())) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const code = decodeURIComponent(params.code);

  const master = await readMaster();
  const linked = master.filter((p) => p.supplierCode === code).length;
  if (linked > 0) {
    return NextResponse.json(
      {
        error: `Can't delete — ${linked} product${linked === 1 ? "" : "s"} still linked to this supplier. Reassign or remove them in Master Data first.`,
      },
      { status: 400 },
    );
  }

  const result = await mutateMasterSuppliers((suppliers) => {
    const i = suppliers.findIndex((s) => s.code === code);
    if (i === -1) return { error: "not_found" as const };
    suppliers.splice(i, 1);
    return { ok: true as const };
  });

  if ("error" in result) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  await removeSupplierFromStores(code);
  return NextResponse.json({ ok: true });
}
