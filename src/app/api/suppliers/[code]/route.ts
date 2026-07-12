import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const NUMERIC = new Set(["minOrderAmount", "leadTime", "taxPct"]);
// Explicit allow-list rather than `key in supplier` — optional fields
// (address, deliverySchedule, taxId…) are absent at runtime on suppliers that
// never had them, so `in` would silently refuse to ever set them.
const STRING_FIELDS = new Set([
  "name", "address", "city", "country", "deliverySchedule", "contactPerson", "phone", "email", "taxId",
]);

export async function PATCH(req: Request, { params }: { params: { code: string } }) {
  const actor = await currentActor();
  const body = await req.json();
  const result = await mutateDB((db) => {
    const supplier = db.suppliers.find((s) => s.code === params.code);
    if (!supplier) return null;
    for (const [key, value] of Object.entries(body)) {
      if (key === "code") continue;
      if (NUMERIC.has(key)) {
        (supplier as any)[key] = Number(value) || 0;
      } else if (STRING_FIELDS.has(key)) {
        (supplier as any)[key] = typeof value === "string" ? value.trim() || undefined : value;
      }
    }
    // Keep every product's display name for this supplier in sync — this is
    // the whole point of a real master: renaming a supplier once should not
    // leave 300 products pointing at a now-stale name.
    if (typeof body.name === "string" && body.name.trim()) {
      const newName = body.name.trim();
      db.products.forEach((p) => {
        if (p.supplierCode === params.code) p.supplier = newName;
      });
    }
    logAudit(db, { actor, action: "Updated", entityType: "Supplier", entity: `${supplier.name} (${supplier.code})` });
    return supplier;
  });

  if (!result) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { code: string } }) {
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const idx = db.suppliers.findIndex((s) => s.code === params.code);
    if (idx === -1) return { error: "not_found" as const };
    const inUse = db.products.some((p) => p.supplierCode === params.code);
    if (inUse) return { error: "in_use" as const };
    const [removed] = db.suppliers.splice(idx, 1);
    logAudit(db, { actor, action: "Deleted", entityType: "Supplier", entity: `${removed.name} (${removed.code})` });
    return { ok: true as const };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    return NextResponse.json(
      { error: "This supplier still has products assigned — reassign them first" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
