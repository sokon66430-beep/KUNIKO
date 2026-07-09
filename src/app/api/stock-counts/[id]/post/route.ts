import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Post the count: set each counted product's stock to the physical quantity,
// logging the adjustment. This is the moment the count becomes the truth.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const result = await mutateDB((db) => {
    const count = db.stockCounts.find((c) => c.id === params.id);
    if (!count) return { error: "not_found" as const };
    if (count.status === "Posted") return { error: "posted" as const };
    if (count.items.length === 0) return { error: "empty" as const };

    let adjusted = 0;
    let netUnits = 0;
    for (const it of count.items) {
      const product = db.products.find((p) => p.id === it.productId);
      if (!product) continue;
      const before = product.stock;
      const target = Math.max(0, it.countedQty);
      const delta = target - before;
      if (delta !== 0) {
        product.stock = target;
        adjusted++;
        netUnits += delta;
      }
    }

    count.status = "Posted";
    count.postedAt = new Date().toISOString();
    logAudit(db, {
      actor: count.countedBy,
      action: "Posted",
      entityType: "Count",
      entity: count.countNo,
      detail: `${adjusted} item${adjusted === 1 ? "" : "s"} adjusted · net ${netUnits >= 0 ? "+" : ""}${netUnits} units`,
    });
    return { count, adjusted, netUnits };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Count not found" }, { status: 404 });
    if (result.error === "posted") return NextResponse.json({ error: "This count is already posted" }, { status: 400 });
    return NextResponse.json({ error: "Nothing has been counted yet" }, { status: 400 });
  }
  return NextResponse.json(result);
}
