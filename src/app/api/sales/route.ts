import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Sale, SaleItem } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

function tierFor(spent: number) {
  if (spent >= 250) return "Gold" as const;
  if (spent >= 100) return "Silver" as const;
  return "Bronze" as const;
}

export async function GET(req: Request) {
  const db = await readDB();
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 50;
  const sales = [...db.sales].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit);

  const session = await getSession();
  if (session && canSeeProfit(session.role)) return NextResponse.json(sales);

  // Cost/profit are restricted to Procurement + owner.
  const redacted = sales.map((s) => ({ ...s, cost: 0, profit: 0 }));
  return NextResponse.json(redacted);
}

export async function POST(req: Request) {
  const body = await req.json();
  const rawItems: { productId: string; qty: number }[] = body?.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
  }

  const result = await mutateDB((db) => {
    const items: SaleItem[] = [];
    for (const raw of rawItems) {
      const product = db.products.find((p) => p.id === raw.productId);
      if (!product) return { error: `Unknown product ${raw.productId}` };
      const qty = Math.max(1, Math.floor(Number(raw.qty) || 1));
      // Overselling is allowed: a sale always goes through even at zero/low
      // stock, and on-hand is allowed to go negative (-1, -2, …) so the count
      // reflects what's owed. Restocking/stock-count brings it back to true.
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        price: product.price,
        cost: product.cost,
      });
    }

    // Selling prices are VAT-INCLUSIVE: the sticker total is what the customer
    // pays; VAT is the portion already inside it, not added on top.
    const gross = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
    const cost = round2(items.reduce((s, it) => s + it.cost * it.qty, 0));
    const discount = round2(Math.min(Number(body.discount) || 0, gross));
    const total = round2(gross - discount);
    const subtotal = round2(total / (1 + db.meta.business.vatRate)); // net of VAT
    const tax = round2(total - subtotal); // VAT already contained in the price
    const profit = round2(total - cost);

    // Commit stock changes
    for (const it of items) {
      const product = db.products.find((p) => p.id === it.productId)!;
      product.stock -= it.qty;
    }

    let customerId: string | null = null;
    let customerName: string | undefined;
    if (body.customerId) {
      const cust = db.customers.find((c) => c.id === body.customerId);
      if (cust) {
        customerId = cust.id;
        customerName = cust.name;
        cust.totalSpent = round2(cust.totalSpent + total);
        cust.visits += 1;
        cust.loyaltyPoints += Math.floor(total);
        cust.lastVisit = new Date().toISOString();
        cust.tier = tierFor(cust.totalSpent);
      }
    }

    const invoiceNo = `INV-${db.meta.nextInvoice}`;
    const sale: Sale = {
      id: `s${db.meta.nextInvoice}`,
      invoiceNo,
      items,
      customerId,
      customerName,
      subtotal,
      discount,
      tax,
      total,
      cost,
      profit,
      paymentMethod: body.paymentMethod || "Cash",
      paymentRef: body.paymentRef || undefined,
      createdAt: new Date().toISOString(),
    };
    db.meta.nextInvoice += 1;
    db.sales.push(sale);
    return { sale };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.sale, { status: 201 });
}

// Clear ALL sales for the current store so a fresh set can be re-imported.
// Owner-only and irreversible. Stock is left untouched: imported (historical)
// sales never changed stock, and silently adding units back from live sales
// would inflate on-hand counts — so this only wipes the sales history.
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can clear sales." }, { status: 403 });
  }
  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const removed = db.sales.length;
    db.sales = [];
    logAudit(db, {
      actor,
      action: "Cleared",
      entityType: "Sale",
      entity: "All sales",
      detail: `${removed} sale${removed === 1 ? "" : "s"} deleted`,
    });
    return { removed };
  });
  return NextResponse.json(result);
}
