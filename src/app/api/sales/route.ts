import { NextResponse } from "next/server";
import { groupsForCategory, optionsPrice } from "@/lib/options";
import { readDB, mutateDB } from "@/lib/db";
import type { Coupon, Recipe, Sale, SaleItem, StockMovement, SaleItemOption } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManageStaff } from "@/lib/access";
import { profitFor } from "@/lib/caps";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";
import { publish } from "@/lib/realtime";
import { issueQueueTicket } from "@/lib/queue";
import { checkCoupon, findCoupon, redeemCoupon } from "@/lib/coupons";
import { openShiftForTerminal } from "@/lib/money";
import { currentActor } from "@/lib/actor";
import { findByCode, isSellable, storeToday } from "@/lib/markdowns";
import { consumptionPlan, recipeCosting, recipeFor } from "@/lib/recipes";
import { applyPromotions, DEFAULT_PROMOTION_SETTINGS } from "@/lib/promotions";
import { unitById, toBaseQty, type ResolvedUnit } from "@/lib/sellingUnits";

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
  if (session && (await profitFor(session.role))) return NextResponse.json(sales);

  // Cost/profit are restricted to Procurement + owner.
  const redacted = sales.map((s) => ({ ...s, cost: 0, profit: 0 }));
  return NextResponse.json(redacted);
}

export async function POST(req: Request) {
  const body = await req.json();
  // `qty` is in BASE units. `unitId` + `unitQty` say the line was rung up on a
  // bigger packaging; the server re-reads that packaging rather than trusting
  // the numbers, so a tampered request can't buy a case at a can's price.
  const rawItems: {
    productId: string;
    qty: number;
    markdownCode?: string;
    unitId?: string;
    unitQty?: number;
    // Condiment choices as IDs only. The names and any price come from the
    // store's stored groups — see below.
    options?: { groupId: string; choiceId: string }[];
  }[] = body?.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
  }

  const actor = await currentActor();
  const session = await getSession();
  const role = session?.role ?? "store_crew";

  const result = await mutateDB((db) => {
    // Idempotency for KHQR/ABA (and any card-network) payments: the request
    // carries a paymentRef — the bank's transaction id (md5). If a sale already
    // exists for this ref, a retry must return that ONE sale and never create a
    // second, so a post-payment commit retry can't double-record the sale. The
    // check runs inside the write-lock, so two racing commits can't both pass.
    if (body.paymentRef) {
      const existing = db.sales.find((s) => s.paymentRef === body.paymentRef);
      if (existing) return { sale: existing };
    }
    // The same protection for CASH, which had none — and cash is most sales.
    //
    // The till sends a reference it keeps for one checkout attempt. If the shop
    // wifi stalls, the request times out on the device while the server has
    // already committed: the cashier sees an error and no receipt, presses
    // Charge again, and the shop ends up with two sales, stock off by a basket
    // and a drawer that cannot be reconciled — for one customer who paid once.
    //
    // With a reference, the retry finds the sale it already made and returns
    // it, so the cashier gets their receipt and the books stay right. Inside
    // the write-lock, so two racing retries cannot both pass.
    if (body.clientRef) {
      const existing = db.sales.find((s) => s.clientRef === body.clientRef);
      if (existing) return { sale: existing };
    }
    const items: SaleItem[] = [];
    // Which recipe (if any) each item is made from, kept alongside `items` so
    // the stock pass below doesn't have to resolve the link a second time.
    const recipeByItem = new Map<number, Recipe>();
    const today = storeToday();
    for (const raw of rawItems) {
      const product = db.products.find((p) => p.id === raw.productId);
      if (!product) return { error: `Unknown product ${raw.productId}` };
      let qty = Math.max(1, Math.floor(Number(raw.qty) || 1));

      // A packaging line ("2 cases") is re-resolved here: the conversion and the
      // price come from the product's own record, and the base quantity is
      // recomputed rather than believed. `price` stays PER BASE UNIT so the rest
      // of this route — stock, cost, VAT, promotions — needs no special case.
      let unit: ResolvedUnit | undefined;
      let unitQty: number | undefined;
      if (raw.unitId && raw.unitId !== "base") {
        unit = unitById(product, raw.unitId);
        if (!unit) return { error: `${product.name} has no packaging "${raw.unitId}".` };
        if (!unit.active) return { error: `${product.name} is no longer sold by the ${unit.name}.` };
        unitQty = Math.max(1, Math.floor(Number(raw.unitQty) || 1));
        qty = toBaseQty(unit, unitQty);
      }

      // A discounted line names its markdown label; the PRICE is taken from the
      // stored label, never from the client, and only if the label is still
      // live and belongs to this product. Anything else falls back to full
      // price rather than trusting what was sent.
      let price = unit ? unit.price / unit.conversion : product.price;
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

      // How the customer wants it made — spice level, sweetness.
      //
      // Resolved from the STORE's configured groups, never from what the till
      // sent: the name that prints on the kitchen ticket and any money the
      // choice carries both come from the stored record. A till could otherwise
      // invent a free "extra shot", or send a label the kitchen never agreed to.
      const chosen: SaleItemOption[] = [];
      if (Array.isArray(raw.options)) {
        const groups = groupsForCategory(db.meta.business.optionGroups, product.category);
        for (const sel of raw.options) {
          const g = groups.find((x) => x.id === sel?.groupId);
          const c = g?.choices.find((x) => x.id === sel?.choiceId);
          if (!g || !c) continue; // unknown or not valid for this product's category
          chosen.push({ group: g.name, choice: c.name, priceDelta: c.priceDelta || undefined });
        }
      }
      // Added to the unit price, so VAT, discounts, promotions and every total
      // downstream need no special case for condiments.
      price = round2(price + optionsPrice(chosen));

      // Overselling is allowed: a sale always goes through even at zero/low
      // stock, and on-hand is allowed to go negative (-1, -2, …) so the count
      // reflects what's owed. Restocking/stock-count brings it back to true.
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        options: chosen.length ? chosen : undefined,
        qty,
        price,
        cost,
        markdownCode,
        markdownPercent,
        fullPrice,
        recipeId: recipe?.id,
        recipeName: recipe?.name,
        unitId: unit?.id,
        unitName: unit?.name,
        unitQty,
        unitPrice: unit?.price,
        conversion: unit?.conversion,
      });
    }

    // Selling prices are VAT-INCLUSIVE: the sticker total is what the customer
    // pays; VAT is the portion already inside it, not added on top.
    const gross = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
    const cost = round2(items.reduce((s, it) => s + it.cost * it.qty, 0));

    // Promotions are worked out HERE, from the basket, and never taken from the
    // client. The till previews the same deals with the same engine, but a
    // tampered request can't invent a discount — the server re-derives it from
    // the promotion records and the prices it just resolved itself.
    const basket = applyPromotions(
      items.map((it) => ({
        productId: it.productId,
        qty: it.qty,
        unitPrice: it.price,
        markdownCode: it.markdownCode,
      })),
      db.promotions,
      db.products,
      db.meta.business.promotionSettings || DEFAULT_PROMOTION_SETTINGS,
    );

    // A manual discount and the automatic ones stack into one figure, capped so
    // a basket can never total below zero.
    //
    // The manual figure is the ONE money input taken from the client, so it is
    // also the one a till session could abuse — POSTing {discount: 999} would
    // otherwise ring a full basket through at $0.00 with stock deducted and a
    // valid invoice. The POS no longer sends it at all, so anything non-zero
    // from a non-leadership session is refused rather than honoured.
    const requestedDiscount = Math.max(0, Number(body.discount) || 0);
    if (requestedDiscount > 0 && !canManageStaff(role)) {
      return { error: "Only a manager can apply a discount" as const };
    }
    const manualDiscount = requestedDiscount;

    // The coupon the customer handed over. Unlike the manual discount above,
    // NOTHING about its value is taken from the client — only the code is. The
    // amount is re-derived here from the stored coupon, so a till that posts
    // {couponCode:"93…", discount:999} still only gets what that coupon is
    // worth.
    //
    // Validated against the basket AFTER promotions and mark-downs, because a
    // coupon comes off what the customer would otherwise have paid.
    const scannedCoupon = String(body.couponCode || "").trim();
    const afterDeals = round2(Math.max(0, gross - manualDiscount - basket.discount));
    let coupon: Coupon | undefined;
    let couponOff = 0;
    if (scannedCoupon) {
      coupon = findCoupon(db.coupons || [], scannedCoupon);
      // Re-checked here, inside the write-lock, even though the till already
      // asked: between the scan and this moment another till may have spent the
      // same single-use voucher. This is the check that decides.
      const verdict = checkCoupon(coupon, afterDeals, { storeId: session?.storeId });
      if (!verdict.ok) return { error: verdict.reason };
      couponOff = verdict.discount;
    }

    const discount = round2(Math.min(manualDiscount + basket.discount + couponOff, gross));
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
        postLedger(db, product, { type: "SALE", qty: -it.qty, by: actor, ref: invoiceNo });
        continue;
      }

      const { deductions, problems } = consumptionPlan(recipe, db.products, it.qty);
      for (const d of deductions) {
        const ingredient = db.products.find((p) => p.id === d.productId)!;
        // Never blocked and never floored at zero: the bowl has been served, so
        // the beef is gone whatever the system thought it had. Letting stock go
        // negative is what makes the shortage visible instead of hiding it.
        // (Also in stockMovements below with the full recipe context — that is
        // the recipe ledger; this is the stock ledger.)
        postLedger(db, ingredient, { type: "SALE", qty: -d.qtyDeducted, by: actor, ref: invoiceNo, note: `recipe: ${recipe.name}` });

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

    // Record each deal that fired. Stock needs nothing special here: a "free"
    // bottle is one the customer scanned, so it's already in `items` and has
    // already come off the shelf above — the deal only changes what's charged.
    const nameOf = (id: string) => items.find((i) => i.productId === id)?.name || id;
    const skuOf = (id: string) => items.find((i) => i.productId === id)?.sku || "";
    for (const a of basket.applications) {
      const seq = db.meta.nextPromotionUsage++;
      db.promotionUsages.push({
        id: `pu${seq}`,
        at: now,
        saleId,
        invoiceNo,
        cashier: actor,
        promotionId: a.promotionId,
        promotionCode: a.code,
        promotionName: a.name,
        type: a.type,
        detail: a.detail,
        discount: a.discount,
        freeQty: a.freeQty,
        qty: a.qty,
        revenue: a.revenue,
        items: a.items.map((i) => ({
          productId: i.productId,
          sku: skuOf(i.productId),
          name: nameOf(i.productId),
          qty: i.qty,
          freeQty: i.freeQty,
        })),
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
    let cashUsd: number | undefined;
    let cashRiel: number | undefined;
    if (method === "Cash" && body.tendered != null) {
      const rate = db.meta.business?.exchangeRate || 4100;
      // The client sends how much was received in each currency. Older callers
      // send only the combined USD `tendered` — treat that as all dollars.
      const tUsd = round2(Math.max(0, Number(body.tenderedUsd ?? body.tendered) || 0));
      const tRiel = Math.max(0, Math.floor(Number(body.tenderedRiel) || 0));
      tendered = round2(Math.max(0, Number(body.tendered) || 0));
      change = round2(Math.max(0, tendered - total));
      // Change is handed back in dollars, so every riel note stays in the till
      // and the dollar side absorbs the change (it can go negative when the
      // customer pays mostly riel and takes dollar change). Net value = total.
      cashRiel = tRiel;
      cashUsd = round2(tUsd - change);
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
      promotions: basket.applications.length
        ? basket.applications.map((a) => ({
            code: a.code,
            name: a.name,
            detail: a.detail,
            discount: a.discount,
            freeQty: a.freeQty,
          }))
        : undefined,
      paymentMethod: method,
      paymentRef: body.paymentRef || undefined,
      tendered,
      change,
      cashUsd,
      cashRiel,
      createdAt: now,
      // From the session, not the request body — the receipt's "who served you"
      // has to be an audit fact, not something a till could claim.
      cashier: actor,
      // The till's reference for this checkout attempt, so a retry after a
      // timeout returns this sale instead of making a second one.
      clientRef: typeof body.clientRef === "string" ? body.clientRef.slice(0, 64) : undefined,
    };

    // Money management: attribute the sale to the till and its OPEN shift, so a
    // cash sale lands in the right drawer. Never blocks a sale — if no shift is
    // open the sale still goes through, just unattributed (the shift/terminal
    // stay undefined). See lib/money.drawerFor.
    const posTerminalId = typeof body.posTerminalId === "string" ? body.posTerminalId.trim() : "";
    if (posTerminalId) {
      sale.posTerminalId = posTerminalId;
      const openShift = openShiftForTerminal(db, posTerminalId);
      if (openShift) sale.shiftId = openShift.id;
    }

    // Pickup number: only when the cashier asked for one at the till (body.queue).
    // Issued centrally so every terminal shares the sequence — see lib/queue.
    if (body.queue) {
      const ticket = issueQueueTicket(db, {
        saleId,
        receiptNo: invoiceNo,
        posTerminalId: typeof body.posTerminalId === "string" ? body.posTerminalId : undefined,
        cashier: actor,
        at: now,
        items, // so the kitchen lanes are built from what was actually sold
      });
      sale.queueNumber = ticket.number;
      sale.queueTicketId = ticket.id;
      sale.queueCode = ticket.code;
    }

    // Spend the coupon. Here, and only here — the same write-lock that wrote
    // the sale — so a single-use voucher can be redeemed exactly once even if
    // three tills scan it in the same second, and so an abandoned basket never
    // burns a customer's coupon.
    if (coupon && couponOff > 0) {
      sale.coupon = { code: coupon.code, name: coupon.name, discount: couponOff };
      redeemCoupon(db, coupon, {
        saleId,
        invoiceNo,
        cashier: actor,
        posTerminalId: sale.posTerminalId,
        basketTotal: afterDeals,
        discount: couponOff,
        at: now,
      });
    }

    db.meta.nextInvoice += 1;
    db.sales.push(sale);
    return { sale };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // Push the new ticket to the kitchen display and the customer TV. After the
  // write has committed, and deliberately not inside mutateDB: a screen must
  // never be able to hold up — or roll back — a payment.
  if (result.sale.queueTicketId) publish(session?.storeId || "", "queue:changed", { saleId: result.sale.id });
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
