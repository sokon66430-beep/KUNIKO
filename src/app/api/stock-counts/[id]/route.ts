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
  // countedQty = set the absolute total (manual edit / import).
  // addQty     = add to the running total (a scan of another spot). Done here
  //              on the server, inside the write-lock, so two people scanning
  //              the same product at once both count — neither overwrites.
  const items: { productId: string; countedQty?: number; addQty?: number; remove?: boolean }[] = Array.isArray(
    body.items,
  )
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
      const adding = it.addQty != null;
      const delta = Math.max(0, Number(it.addQty) || 0);
      const setTo = Math.max(0, Number(it.countedQty) || 0);
      if (existing) {
        existing.countedQty = adding ? existing.countedQty + delta : setTo;
        existing.countedBy = who;
        existing.countedAt = at;
      } else {
        const line: StockCountItem = {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          barcode: product.barcode,
          systemQty: product.stock,
          countedQty: adding ? delta : setTo,
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

// Delete a stock count — but only with a valid Manager / Assistant-Manager
// approval code (same approver list as receipt-edit & write-off cancellations).
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim();
  const session = await getSession();

  const result = await mutateDB((db) => {
    const idx = db.stockCounts.findIndex((c) => c.id === params.id);
    if (idx === -1) return { error: "not_found" as const };
    const approver = (db.meta.business.approvers || []).find((a) => a.code && a.code === code);
    if (!approver) return { error: "bad_code" as const };
    const [removed] = db.stockCounts.splice(idx, 1);
    const approverName = `${approver.role}${approver.name ? ` (${approver.name})` : ""}`;
    logAudit(db, {
      actor: approverName,
      action: "Deleted",
      entityType: "Count",
      entity: removed.countNo,
      detail: `approved deletion${session?.name ? ` · requested by ${session.name}` : ""}`,
    });
    return { ok: true as const };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Count not found" }, { status: 404 });
    return NextResponse.json({ error: "Invalid approval code" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
