import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { readMasterSuppliers } from "@/lib/master";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Suppliers are edited only in Master Data (owner-only), which mirrors the
// change to every store. See /api/master/suppliers/[code].
export async function PATCH() {
  return NextResponse.json({ error: "Suppliers are managed in Master Data." }, { status: 403 });
}

/**
 * Remove a STRAY supplier from this store's list.
 *
 * The store list is meant to be a mirror of Master Data, so normally nothing is
 * deleted here. The exception this exists for: the product importer used to
 * CREATE a supplier out of whatever sat in the sheet's supplier column, so a
 * shifted column left records like "113" or "431 / SUPO153, SUPO153" in the
 * store list — present in no master, editable nowhere, deletable nowhere. The
 * importer no longer does that (see api/products/import), but the rows it
 * already made need a way out.
 *
 * Deliberately narrow, so this can never become a back door around Master Data:
 *
 *   - owner only;
 *   - REFUSED if the code exists in Master Data — a real supplier is deleted
 *     there, where the deletion propagates to every store;
 *   - REFUSED if any product in this store still points at it, by code or by
 *     name, so nothing is left orphaned.
 *
 * What remains is a record that links to nothing and exists nowhere else —
 * removing it loses no information.
 */
export async function DELETE(_req: Request, { params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can remove a supplier." }, { status: 403 });
  }
  const code = decodeURIComponent(params.code);

  const master = await readMasterSuppliers();
  if (master.some((s) => s.code === code)) {
    return NextResponse.json(
      { error: "This supplier is in Master Data — delete it there so every store is updated." },
      { status: 400 },
    );
  }

  const db = await readDB();
  const supplier = db.suppliers.find((s) => s.code === code);
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  // Match on NAME as well as code: a product carries both, and clearing a
  // supplier that some product still displays would leave that product naming
  // something that no longer exists.
  const linked = db.products.filter(
    (p) => p.supplierCode === code || (p.supplier && p.supplier === supplier.name),
  ).length;
  if (linked > 0) {
    return NextResponse.json(
      {
        error: `Can't remove — ${linked} product${linked === 1 ? "" : "s"} still linked to it. Point them at the right supplier first.`,
      },
      { status: 400 },
    );
  }

  const actor = await currentActor();
  await mutateDB((db) => {
    const i = db.suppliers.findIndex((s) => s.code === code);
    if (i === -1) return false;
    db.suppliers.splice(i, 1);
    logAudit(db, {
      actor,
      action: "Deleted",
      entityType: "Supplier",
      entity: supplier.name === code ? code : `${supplier.name} (${code})`,
      detail: "Stray supplier removed — not in Master Data, no products linked",
    });
    return true;
  });

  return NextResponse.json({ ok: true });
}
