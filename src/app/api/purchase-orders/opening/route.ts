import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { storeExists } from "@/lib/system";
import { nextPoNumber } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { PurchaseOrder, POItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Opening order to STOCK A (usually new) STORE: a set of { productId | sku, qty }
// lines grouped into one Purchase Order per supplier. The POs are created in the
// chosen destination store (body.storeId) so its own stock fills when received.
// Targeting a store other than your own requires the owner.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const actor = await currentActor();
  const body = await req.json().catch(() => ({}));
  const rawItems: { productId?: string; sku?: string; qty: number }[] = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) return NextResponse.json({ error: "No items to order" }, { status: 400 });

  const targetStoreId = String(body.storeId || "").trim() || session.storeId;
  if (targetStoreId !== session.storeId && session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can stock another store" }, { status: 403 });
  }
  if (!(await storeExists(targetStoreId))) {
    return NextResponse.json({ error: "That store doesn't exist" }, { status: 404 });
  }

  const result = await mutateDB((db) => {
    const bySku = new Map(db.products.map((p) => [p.sku, p]));
    const byId = new Map(db.products.map((p) => [p.id, p]));

    // Group lines by supplier.
    const bySupplier = new Map<string, POItem[]>();
    for (const it of rawItems) {
      const p = (it.productId && byId.get(it.productId)) || (it.sku && bySku.get(it.sku));
      if (!p) continue;
      const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
      if (qty <= 0) continue;
      const supplier = p.supplier || "—";
      const line: POItem = {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit || "pcs",
        qtyOrdered: qty,
        qtyReceived: 0,
        cost: p.cost,
        barcode: p.barcode || undefined,
      };
      (bySupplier.get(supplier) ?? bySupplier.set(supplier, []).get(supplier)!).push(line);
    }
    if (bySupplier.size === 0) return { created: [] as { poNo: string; supplier: string; items: number }[] };

    const now = new Date();
    const note = body.note?.trim() || "New store opening order";
    const created: { poNo: string; supplier: string; items: number }[] = [];
    // Suppliers with the most lines first — biggest POs on top.
    const groups = [...bySupplier.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [supplier, lines] of groups) {
      const n = db.meta.nextPO++;
      const po: PurchaseOrder = {
        id: `po${n}`,
        poNo: nextPoNumber(db.purchaseOrders.map((p) => p.poNo), now),
        supplier,
        status: "Open",
        note,
        items: lines,
        createdAt: now.toISOString(),
      };
      db.purchaseOrders.push(po);
      created.push({ poNo: po.poNo, supplier, items: lines.length });
    }

    logAudit(db, {
      actor,
      action: "Created",
      entityType: "PO",
      entity: `${created.length} PO${created.length === 1 ? "" : "s"}`,
      detail: `New store opening — ${rawItems.length} lines across ${created.length} supplier${created.length === 1 ? "" : "s"}`,
    });
    return { created };
  }, targetStoreId);

  return NextResponse.json({ ...result, storeId: targetStoreId }, { status: 201 });
}
