import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import type { StockCountItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const count = db.stockCounts.find((c) => c.id === params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });
  return NextResponse.json(count);
}

// Record counted quantities (from scanning/typing on screen). Snapshots the
// system stock the first time each product is added to the count.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const items: { productId: string; countedQty?: number; remove?: boolean }[] = Array.isArray(body.items)
    ? body.items
    : [];
  const session = await getSession();
  const who = String(body.countedBy || "").trim() || session?.name || "Counter";
  const at = new Date().toISOString();

  const result = await mutateDB((db) => {
    const count = db.stockCounts.find((c) => c.id === params.id);
    if (!count) return { error: "not_found" as const };
    if (count.status === "Posted") return { error: "posted" as const };

    if (typeof body.note === "string") count.note = body.note.trim() || undefined;

    for (const it of items) {
      const product = db.products.find((p) => p.id === it.productId);
      if (!product) continue;
      const existing = count.items.find((x) => x.productId === it.productId);
      if (it.remove) {
        if (existing) count.items = count.items.filter((x) => x.productId !== it.productId);
        continue;
      }
      const qty = Math.max(0, Number(it.countedQty) || 0);
      if (existing) {
        existing.countedQty = qty;
        existing.countedBy = who;
        existing.countedAt = at;
      } else {
        const line: StockCountItem = {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          barcode: product.barcode,
          systemQty: product.stock,
          countedQty: qty,
          countedBy: who,
          countedAt: at,
        };
        count.items.push(line);
      }
    }
    return { count };
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error === "not_found" ? "Count not found" : "This count is already posted" },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json(result.count);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = await mutateDB((db) => {
    const idx = db.stockCounts.findIndex((c) => c.id === params.id);
    if (idx === -1) return false;
    const [removed] = db.stockCounts.splice(idx, 1);
    logAudit(db, { actor: "Admin", action: "Deleted", entityType: "Count", entity: removed.countNo });
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Count not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
