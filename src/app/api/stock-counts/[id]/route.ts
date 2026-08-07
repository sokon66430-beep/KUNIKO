import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { resolveApprover } from "@/lib/managerAuth";
import { COUNT_PLACES, type StockCountItem, type CountPlace } from "@/lib/types";

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
  const items: { productId: string; countedQty?: number; addQty?: number; place?: CountPlace; remove?: boolean }[] =
    Array.isArray(body.items) ? body.items : [];
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
      const place = COUNT_PLACES.includes(it.place as CountPlace) ? (it.place as CountPlace) : undefined;
      if (existing) {
        existing.countedQty = adding ? existing.countedQty + delta : setTo;
        if (adding && place) {
          existing.placeQty = existing.placeQty || {};
          existing.placeQty[place] = (existing.placeQty[place] || 0) + delta;
        }
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
          placeQty: adding && place ? { [place]: delta } : undefined,
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

  // Resolved BEFORE the mutation: it reads the store file and the system file,
  // and a nested read inside mutateDB's write window is a deadlock waiting to
  // be discovered by whoever deletes a count on a busy evening.
  const approverName = session
    ? await resolveApprover(code, { storeId: session.storeId, purpose: "approveCash" })
    : null;

  const result = await mutateDB((db) => {
    const idx = db.stockCounts.findIndex((c) => c.id === params.id);
    if (idx === -1) return { error: "not_found" as const };
    if (!approverName) return { error: "bad_code" as const };
    const [removed] = db.stockCounts.splice(idx, 1);
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
    return NextResponse.json(
      { error: "Code not recognised — a manager can use their own POS PIN." },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
