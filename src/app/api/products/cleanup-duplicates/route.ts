import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// Remove duplicate products created by past imports. A product is removed
// ONLY when all three hold, so nothing real can be lost:
//   1. its Item ID is an auto-generated placeholder (SKU-1234) — meaning the
//      import invented it because the row had no real code;
//   2. another product with a REAL Item ID has the exact same name (the
//      canonical master record stays);
//   3. it is referenced nowhere — no sale, PO, PR, receipt, count or write-off.
// Owner-only and audited.
const isAuto = (sku: string) => /^SKU-\d+$/.test(sku || "");
const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can clean up products." }, { status: 403 });
  }
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const used = new Set<string>();
    db.sales.forEach((s) => s.items.forEach((i) => used.add(i.productId)));
    db.purchaseOrders.forEach((o) => o.items.forEach((i) => used.add(i.productId)));
    db.purchaseRequests.forEach((o) => o.items.forEach((i) => used.add(i.productId)));
    db.goodsReceipts.forEach((g) => g.items.forEach((i) => used.add(i.productId)));
    db.stockCounts.forEach((c) => c.items.forEach((i) => used.add(i.productId)));
    db.writeOffs.forEach((w) => used.add(w.productId));

    const realNames = new Set(db.products.filter((p) => !isAuto(p.sku)).map((p) => norm(p.name)));
    const before = db.products.length;
    const removedNames = new Map<string, number>();
    db.products = db.products.filter((p) => {
      const junk = isAuto(p.sku) && !used.has(p.id) && realNames.has(norm(p.name));
      if (junk) removedNames.set(p.name, (removedNames.get(p.name) || 0) + 1);
      return !junk;
    });
    const removed = before - db.products.length;

    if (removed > 0) {
      logAudit(db, {
        actor,
        action: "Cleaned",
        entityType: "Product",
        entity: "Duplicate products",
        detail: `${removed} duplicate${removed === 1 ? "" : "s"} removed (${removedNames.size} name${removedNames.size === 1 ? "" : "s"})`,
      });
    }
    return {
      removed,
      remaining: db.products.length,
      names: [...removedNames.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, count })),
    };
  });

  return NextResponse.json(result);
}
