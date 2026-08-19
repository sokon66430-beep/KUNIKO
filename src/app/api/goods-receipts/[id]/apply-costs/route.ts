import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
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
 * IT IS STILL A SEPARATE ACT from receiving, because repricing the catalogue
 * moves every margin, report and stock valuation in the business and should
 * not happen as a side effect of unloading a pallet.
 *
 * WHO MAY DO IT IS THE MASTER DATA CAPABILITY, not an approval code.
 *
 * The first draft demanded a manager's code, which was wrong twice over. It
 * invented a rule this app does not have — the owner decides on /permissions
 * who may edit company-wide products, and cap:master-data is that decision
 * already made. And it put a second, hidden gate in front of people the owner
 * had ALREADY granted the function to, so a procurement clerk who can edit any
 * cost in Master Data directly could not accept the one an invoice proves.
 *
 * So: whoever the owner has given Master Data to can do this, exactly as they
 * can already change the same cost on the Master Data screen. The audit line
 * below is what makes it reviewable, which is the part that actually matters.
 *
 * ONCE ONLY. Applying twice would read the already-corrected cost as the
 * expected one and write it back over itself — harmless once, and permanently
 * confusing to anybody reading the audit trail afterwards.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // Resolved OUTSIDE the write window: it reads the owner's live permission
  // config, and mutateDB's callback must stay synchronous.
  const session = await getSession();
  const allowed = session ? await masterDataFor(session.role) : false;
  // The signed-in person, by name — not a badge holder standing beside them.
  // That is the point of moving off the code: the audit line now says who
  // actually did it rather than whose card was tapped.
  const who = session ? `${session.name} (${session.role})` : null;

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return { error: "not_found" as const };
    if (grn.costsAppliedAt) return { error: "already" as const };

    const corrections = grn.items.filter((i) => i.costWas !== undefined && i.cost !== undefined);
    if (corrections.length === 0) return { error: "nothing" as const };

    // Checked AFTER the receipt is known to have something to apply, so a
    // permission failure on a receipt with nothing to accept still reports the
    // real problem rather than blaming the person.
    if (!allowed || !who) return { error: "not_allowed" as const };

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
      { error: "Accepting costs needs Master Data access — the owner grants it on Permissions." },
      { status: 403 },
    );
  }

  return NextResponse.json(result);
}
