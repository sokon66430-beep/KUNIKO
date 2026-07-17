import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Recipe, Sale, SaleItem, StockMovement } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canSeeProfit } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";
import { findByCode, isSellable, storeToday } from "@/lib/markdowns";
import { consumptionPlan, recipeCosting, recipeFor } from "@/lib/recipes";

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
  const rawItems: { productId: string; qty: number; markdownCode?: string }[] = body?.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
  }

  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const items: SaleItem[] = [];
    // Which recipe (if any) each item is made from, kept alongside `items` so
    // the stock pass below doesn't have to resolve the link a second time.
    const recipeByItem = new Map<number, Recipe>();
    const today = storeToday();
    for (const raw of rawItems) {
      const product = db.products.find((p) => p.id === raw.productId);
      if (!product) return { error: `Unknown product ${raw.productId}` };
      const qty = Math.max(1, Math.floor(Number(raw.qty) || 1));

      // A discounted line names its markdown label; the PRICE is taken from the
      // stored label, never from the client, and only if the label is still
      // live and belongs to this product. Anything else falls back to full
      // price rather than trusting what was sent.
      let price = product.price;
      let markdownCode: string | undefined;
      let markdownPercent: number | undefined;
      let fullPrice: number | undefined;
      if (raw.markdownCode) {
        const m = findByCode(db.markdowns, raw.markdownCode);
        if (!m) return { error: `Unknown discount label ${raw.markdownCode}` };
        if (m.productId !== product.id) return { error: `Discount label ${m.code} is not for ${product.name}.` };
        if (!isSellable(m, today)) {
          return { error: `Discount label ${m.code} for ${product.name} is no longer valid — sell at full price.` };
        }
        price = m.price;
        markdownCode = m.code;
        markdownPercent = m.percent;
        fullPrice = m.originalPrice;
      }

      // A made-to-order product costs what its ingredients cost, not whatever
      // sits in its own cost field — that field is a guess for anything the
      // kitchen assembles. Costing live off the recipe is what makes the profit
      // on a bowl of noodles mean something.
      const recipe = recipeFor(product, db.recipes);
      let cost = product.cost;
      if (recipe) {
        recipeByItem.set(items.length, recipe);
        cost = recipeCosting(recipe, db.products).total;
      }

      // Overselling is allowed: a sale always goes through even at zero/low
      // stock, and on-hand is allowed to go negative (-1, -2, …) so the count
      // reflects what's owed. Restocking/stock-count brings it back to true.
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        price,
        cost,
        markdownCode,
        markdownPercent,
        fullPrice,
        recipeId: recipe?.id,
        recipeName: recipe?.name,
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

    // The invoice number is allocated before stock moves so each recipe
    // consumption can name the sale that caused it.
    const invoiceNo = `INV-${db.meta.nextInvoice}`;
    const saleId = `s${db.meta.nextInvoice}`;
    const now = new Date().toISOString();

    // Commit stock changes.
    //
    // A product made to order has no stock of its own to take — what it costs
    // the store is the ingredients. So a recipe-backed line deducts the recipe
    // and leaves the product's own count alone; everything else comes straight
    // off the shelf as before.
    const shortages: string[] = [];
    for (const [index, it] of items.entries()) {
      const product = db.products.find((p) => p.id === it.productId)!;
      const recipe = recipeByItem.get(index);
      if (!recipe) {
        product.stock -= it.qty;
        continue;
      }

      const { deductions, problems } = consumptionPlan(recipe, db.products, it.qty);
      for (const d of deductions) {
        const ingredient = db.products.find((p) => p.id === d.productId)!;
        // Never blocked and never floored at zero: the bowl has been served, so
        // the beef is gone whatever the system thought it had. Letting stock go
        // negative is what makes the shortage visible instead of hiding it.
        ingredient.stock = Math.round((ingredient.stock - d.qtyDeducted) * 1e6) / 1e6;

        const seq = db.meta.nextMovement++;
        const movement: StockMovement = {
          id: `mv${seq}`,
          type: "Recipe Consumption",
          at: now,
          actor,
          saleId,
          invoiceNo,
          recipeId: recipe.id,
          recipeName: recipe.name,
          soldProductId: product.id,
          soldProductName: product.name,
          soldQty: it.qty,
          productId: ingredient.id,
          sku: ingredient.sku,
          name: ingredient.name,
          qtyUsed: d.qtyUsed,
          unit: d.unit,
          qtyDeducted: d.qtyDeducted,
          stockUnit: d.stockUnit,
          stockAfter: ingredient.stock,
          cost: d.cost,
        };
        db.stockMovements.push(movement);

        if (ingredient.stock < 0) {
          shortages.push(`${ingredient.name} ${ingredient.stock} ${d.stockUnit}`);
        }
      }

      // An ingredient we couldn't deduct is a data problem, not a sale problem.
      // The sale stands; the audit trail carries the reason so someone can fix
      // the recipe rather than discover the gap at the next stock count.
      for (const p of problems) {
        logAudit(db, {
          actor,
          action: "Recipe warning",
          entityType: "Recipe",
          entity: `${recipe.code} · ${recipe.name}`,
          detail: `${invoiceNo}: ${p.message}`,
          at: now,
        });
      }
    }

    if (shortages.length) {
      logAudit(db, {
        actor,
        action: "Negative stock",
        entityType: "Stock",
        entity: invoiceNo,
        detail: `Ingredients now below zero — ${shortages.join(", ")}`,
        at: now,
      });
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

    // Cash tender: what the customer handed over and the change owed back.
    // Recorded for the drawer count / receipt only — it never alters the total,
    // and it's meaningless for KHQR/card, so those keep it undefined.
    const method = body.paymentMethod || "Cash";
    let tendered: number | undefined;
    let change: number | undefined;
    if (method === "Cash" && body.tendered != null) {
      tendered = round2(Math.max(0, Number(body.tendered) || 0));
      change = round2(Math.max(0, tendered - total));
    }

    const sale: Sale = {
      id: saleId,
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
      paymentMethod: method,
      paymentRef: body.paymentRef || undefined,
      tendered,
      change,
      createdAt: now,
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
