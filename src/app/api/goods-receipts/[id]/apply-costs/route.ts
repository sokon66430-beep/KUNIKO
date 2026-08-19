import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveApprover } from "@/lib/managerAuth";
import { logAudit } from "@/lib/audit";
import { applyPurchaseUnitCost } from "@/lib/sellingUnits";

export const dynamic = "force-dynamic";

/**
 * Accept the costs receiving keyed on this receipt into Master Data.
 *
 * THE STEP THAT WAS MISSING. Receiving can already key what the invoice says,
 * and that fixes the receipt — the delivery is valued and documented at the
 * real figure. It does NOT fix the catalogue, so the same wrong cost comes up
 * on the next delivery, the team retypes it, and the stock valuation on the
 * dashboard keeps using a number nobody believes. This is the one action that
 * ends that loop.
 *
 * IT IS DELIBERATELY A SEPARATE, APPROVED ACT. Repricing the catalogue moves
 * every margin, report and stock valuation in the business; doing it as a side
 * effect of somebody unloading a pallet would mean one person's typing changes
 * the shop's numbers with nobody else looking. So the person at the pallet
 * records what they see, and somebody with an approval code decides it is the
 * new truth. Same code, same check as approving a receipt edit.
 *
 * ONCE ONLY. Applying twice would read the already-corrected cost as the
 * expected one and write it back over itself — harmless once, and permanently
 * confusing to anybody reading the audit trail afterwards.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim();

  // Resolved OUTSIDE the write window — it reads the store's manager records,
  // and mutateDB's callback must stay synchronous.
  const session = await getSession();
  const who = session
    ? await resolveApprover(code, { storeId: session.storeId, purpose: "approveCash" })
    : null;

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return { error: "not_found" as const };
    if (grn.costsAppliedAt) return { error: "already" as const };

    const corrections = grn.items.filter((i) => i.costWas !== undefined && i.cost !== undefined);
    if (corrections.length === 0) return { error: "nothing" as const };

    // Checked AFTER the receipt is known to have something to apply, so a bad
    // code on a receipt with no corrections reports the real problem.
    if (!who) return { error: "bad_code" as const };

    const changes: string[] = [];
    const missing: string[] = [];
    for (const line of corrections) {
      const product = db.products.find((p) => p.id === line.productId);
      if (!product) {
        // Deleted from the catalogue since the delivery. Named rather than
        // skipped in silence: the correction is still owed to somebody.
        missing.push(line.name);
        continue;
      }
      // Put it back where the per-unit figure was READ from — the case price
      // when there is one. See applyPurchaseUnitCost.
      const applied = applyPurchaseUnitCost(product, line.cost!);
      changes.push(`${line.name} — ${applied.label}`);
    }

    grn.costsAppliedAt = new Date().toISOString();
    grn.costsAppliedBy = who;

    logAudit(db, {
      actor: who,
      action: "Costs accepted into Master Data",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: `${grn.poNo} · ${changes.join(" · ")}${missing.length ? ` · not applied (product gone): ${missing.join(", ")}` : ""}`,
    });

    return { grn, changes, missing };
  });

  if ("error" in result) {
    if (result.error === "not_found")
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    if (result.error === "already")
      return NextResponse.json(
        { error: "These costs have already been accepted into Master Data." },
        { status: 400 },
      );
    if (result.error === "nothing")
      return NextResponse.json(
        { error: "No costs were corrected on this receipt." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "That approval code was not recognised." },
      { status: 403 },
    );
  }

  return NextResponse.json(result);
}
