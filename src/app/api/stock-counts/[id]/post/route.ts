import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Post the count: correct each product's stock by the variance the count found.
// This is the moment the count becomes the truth.
//
// The store keeps trading while the audit team counts, so the counted number is
// only true for the moment it was written down. It CANNOT be used as the stock
// figure at posting time — by then the till has sold some of what was counted.
//
// So apply the DIFFERENCE the count discovered, not the count itself:
//
//   variance  = countedQty − systemQty   (both as at the moment of counting)
//   new stock = stock now + variance
//
// 10:00 book says 100, audit counts 98 → variance −2 (two genuinely missing).
// 11:00 till sells 5 → book 95, shelf 93.
// 14:00 post → 95 + (−2) = 93. Correct.
//
// Setting stock to the counted 98 instead — which is what this did — silently
// puts the 5 sold units back on the books, every count, for every item that
// moved while the shelf was being counted. The busier the store, the more stock
// a count invents.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const result = await mutateDB((db) => {
    const count = db.stockCounts.find((c) => c.id === params.id);
    if (!count) return { error: "not_found" as const };
    if (count.status === "Posted") return { error: "posted" as const };
    if (count.items.length === 0) return { error: "empty" as const };

    let adjusted = 0;
    let netUnits = 0;
    let movedDuringCount = 0; // lines the till touched between counting and posting
    let soldAfter = 0; // units the POS report says left after they were counted
    for (const it of count.items) {
      const product = db.products.find((p) => p.id === it.productId);
      if (!product) continue;
      const before = product.stock;
      const variance = it.countedQty - it.systemQty;
      // What the uploaded POS report says walked out after this line was
      // counted. The shop sells through another till, so the counted number was
      // true at `countedAt` and is already stale: counted 5 at 10:00 with 1 sold
      // at 10:00 means the shelf holds 4, and 4 is what stock must end up as.
      // Zero when no report was uploaded, which just leaves the count as counted.
      const sold = Math.max(0, it.soldAfterCount ?? 0);
      soldAfter += sold;
      // Never drive stock negative: a count can only correct to something a
      // shelf could actually hold.
      const target = Math.max(0, before + variance - sold);
      if (before !== it.systemQty) movedDuringCount++;
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
      // Say how many lines kept selling mid-count: it's the audit trail's record
      // that the count ran against a live shop floor, and that the variance was
      // measured against the book at counting time rather than at posting.
      detail:
        `${adjusted} item${adjusted === 1 ? "" : "s"} adjusted · net ${netUnits >= 0 ? "+" : ""}${netUnits} units` +
        (soldAfter > 0 ? ` · ${soldAfter} units sold after counting (from POS report)` : "") +
        (movedDuringCount > 0 ? ` · ${movedDuringCount} still selling while counted` : ""),
    });
    return { count, adjusted, netUnits, movedDuringCount, soldAfter };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Count not found" }, { status: 404 });
    if (result.error === "posted") return NextResponse.json({ error: "This count is already posted" }, { status: 400 });
    return NextResponse.json({ error: "Nothing has been counted yet" }, { status: 400 });
  }
  return NextResponse.json(result);
}
