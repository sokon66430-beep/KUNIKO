import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { mutateDB } from "@/lib/db";
import { nextPoNumber, findMergeablePO, appendItemsToPO } from "@/lib/procurement";
import { logAudit } from "@/lib/audit";
import type { PurchaseOrder, POItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Convert an approved PR into one or more POs, grouped by supplier.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const pr = db.purchaseRequests.find((r) => r.id === params.id);
    if (!pr) return { error: "not_found" as const };
    if (pr.status !== "Approved") return { error: "not_approved" as const };
    if (pr.items.length === 0) return { error: "empty" as const };

    const groups = new Map<string, POItem[]>();
    for (const it of pr.items) {
      const key = it.supplier || "—";
      const line: POItem = {
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        qtyOrdered: it.qty,
        qtyReceived: 0,
        cost: it.cost,
        barcode: it.barcode,
      };
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(line);
    }

    const now = new Date();
    const affected: PurchaseOrder[] = [];
    for (const [supplier, items] of groups) {
      // Same supplier, same day, still Open → add to that PO instead of a new one.
      const mergeInto = findMergeablePO(db, supplier, now);
      if (mergeInto) {
        const { added, merged } = appendItemsToPO(mergeInto, items);
        affected.push(mergeInto);
        logAudit(db, {
          actor,
          action: "Updated",
          entityType: "PO",
          entity: mergeInto.poNo,
          detail: `Added ${added} line${added === 1 ? "" : "s"}${merged ? ` · topped up ${merged}` : ""} from ${pr.prNo} (same-day order)`,
        });
        continue;
      }
      const n = db.meta.nextPO++;
      const po: PurchaseOrder = {
        id: `po${n}`,
        // Compute after each push so a multi-supplier PR gets sequential numbers.
        poNo: nextPoNumber(db.purchaseOrders.map((p) => p.poNo), now),
        prId: pr.id,
        prNo: pr.prNo,
        supplier,
        status: "Open",
        items,
        createdAt: now.toISOString(),
      };
      db.purchaseOrders.push(po);
      affected.push(po);
      logAudit(db, {
        actor,
        action: "Created",
        entityType: "PO",
        entity: po.poNo,
        detail: `${supplier} · from ${pr.prNo} · ${items.length} item${items.length === 1 ? "" : "s"}`,
      });
    }
    const created = affected;

    pr.status = "Converted";
    pr.poIds = created.map((p) => p.id);
    logAudit(db, {
      actor,
      action: "Converted",
      entityType: "PR",
      entity: pr.prNo,
      detail: `→ ${created.map((p) => p.poNo).join(", ")}`,
    });
    return { created };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
    if (result.error === "empty")
      return NextResponse.json({ error: "This request has no items to order" }, { status: 400 });
    return NextResponse.json(
      { error: "Only approved requests can be converted to a PO" },
      { status: 400 },
    );
  }
  return NextResponse.json({ pos: result.created }, { status: 201 });
}
