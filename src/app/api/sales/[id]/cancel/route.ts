import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";
import { canCancelInvoice, isCrossStoreRole } from "@/lib/access";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
function tierFor(spent: number) {
  if (spent >= 250) return "Gold" as const;
  if (spent >= 100) return "Silver" as const;
  return "Bronze" as const;
}

// Cancel (void) a sale invoice. Supervisor-only. Everything the sale did is
// undone:
//   • Stock — every stock movement the sale made carries the invoice number as
//     its ledger ref (product lines AND recipe ingredients), so we replay those
//     entries with the opposite sign. One rule puts back whatever came off.
//   • Loyalty — the customer's spend, visits and points are rolled back.
//   • Promotions — the usage records for this sale are removed.
//   • Reports & drawer — the sale is flagged `cancelled`, which every revenue and
//     drawer calc skips. The row itself is KEPT so the void is on the record.
// Imported (historical) sales never moved stock, so cancelling one just flags it.
//
// MANAGER APPROVAL: a void must be authorised by a store manager or assistant
// store manager (or the owner) entering their own login — the person at the till
// can be a cashier, but the manager's code is what approves the cancellation.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "A reason is required to cancel an invoice" }, { status: 400 });

  // Verify the approving manager by their CODE alone — no username. The system
  // finds which manager it belongs to: match the code against every store
  // manager / assistant store manager (or owner) who can approve here.
  const managerCode = String(body.managerCode || body.managerPassword || "");
  if (!managerCode) {
    return NextResponse.json({ error: "A manager code is required to cancel an invoice" }, { status: 400 });
  }
  const sys = await readSystem();
  const approvers = sys.users.filter(
    (u) =>
      canCancelInvoice(u.role) &&
      (isCrossStoreRole(u.role) || u.storeId === session.storeId || (u.storeIds || []).includes(session.storeId)),
  );
  const mgr = approvers.find((u) => verifyPassword(managerCode, u.passwordHash));
  if (!mgr) {
    return NextResponse.json(
      { error: "Manager code not recognised — only a store manager or assistant store manager can approve." },
      { status: 403 },
    );
  }
  const approvedBy = mgr.name;
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const sale = db.sales.find((s) => s.id === params.id);
    if (!sale) return { error: "not_found" as const };
    if (sale.cancelled) return { error: "already" as const };

    // Put stock back by replaying this sale's own ledger entries with the
    // opposite sign. Covers plain and recipe-ingredient lines alike.
    if (!sale.imported) {
      const entries = db.ledger.filter((l) => l.ref === sale.invoiceNo && l.type === "SALE");
      for (const e of entries) {
        const product = db.products.find((p) => p.id === e.productId);
        if (!product) continue;
        postLedger(db, product, {
          type: "STOCK_ADJUSTMENT",
          qty: -e.qty, // e.qty was negative (a sale); negating puts it back
          by: actor,
          ref: sale.invoiceNo,
          note: `invoice ${sale.invoiceNo} cancelled`,
        });
      }
    }

    // Roll back loyalty.
    if (sale.customerId) {
      const cust = db.customers.find((c) => c.id === sale.customerId);
      if (cust) {
        cust.totalSpent = round2(Math.max(0, cust.totalSpent - sale.total));
        cust.visits = Math.max(0, cust.visits - 1);
        cust.loyaltyPoints = Math.max(0, cust.loyaltyPoints - Math.floor(sale.total));
        cust.tier = tierFor(cust.totalSpent);
      }
    }

    // Drop the promotion usage records tied to this sale.
    const before = db.promotionUsages.length;
    db.promotionUsages = db.promotionUsages.filter((u) => u.saleId !== sale.id);
    const promoRemoved = before - db.promotionUsages.length;

    sale.cancelled = true;
    sale.cancelledAt = new Date().toISOString();
    // Who APPROVED the void (the manager whose code authorised it).
    sale.cancelledBy = approvedBy;
    sale.cancelReason = reason;

    // Name both people: who operated the till, and the manager who approved.
    const operator = session.name;
    const bySuffix = operator && operator !== approvedBy ? ` · processed by ${operator}` : "";
    logAudit(db, {
      actor,
      action: "Cancelled",
      entityType: "Sale",
      entity: sale.invoiceNo,
      detail: `Invoice ${sale.invoiceNo} voided (${sale.total.toFixed(2)}) — ${reason} · approved by ${approvedBy}${bySuffix}${
        promoRemoved ? ` · ${promoRemoved} promo usage(s) removed` : ""
      }`,
    });
    return { sale };
  });

  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    return NextResponse.json({ error: "This invoice is already cancelled" }, { status: 400 });
  }
  return NextResponse.json(result.sale);
}
