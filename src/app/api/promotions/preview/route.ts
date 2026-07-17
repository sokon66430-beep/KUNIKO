import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { applyPromotions, DEFAULT_PROMOTION_SETTINGS } from "@/lib/promotions";
import { findByCode, isSellable, storeToday } from "@/lib/markdowns";

export const dynamic = "force-dynamic";

// POST /api/promotions/preview — what would fire on this basket, right now.
//
// The till calls this as the cart changes so the cashier can tell the customer
// what they're getting BEFORE taking the money. It answers with the same engine
// the sale itself uses, reading prices the same way, so the preview and the
// receipt can't disagree.
//
// Read-only: it writes nothing and rings up nothing.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rawItems: { productId: string; qty: number; markdownCode?: string }[] = body?.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ applications: [], discount: 0 });
  }

  const db = await readDB();
  const today = storeToday();

  // Resolve each line's real price here rather than trusting the client's — a
  // preview built on made-up prices would quote the customer a deal the till
  // then refuses to honour.
  const lines = [];
  for (const raw of rawItems) {
    const product = db.products.find((p) => p.id === raw.productId);
    if (!product) continue;
    let unitPrice = product.price;
    let markdownCode: string | undefined;
    if (raw.markdownCode) {
      const m = findByCode(db.markdowns, raw.markdownCode);
      if (m && m.productId === product.id && isSellable(m, today)) {
        unitPrice = m.price;
        markdownCode = m.code;
      }
    }
    lines.push({
      productId: product.id,
      qty: Math.max(1, Math.floor(Number(raw.qty) || 1)),
      unitPrice,
      markdownCode,
    });
  }

  const result = applyPromotions(
    lines,
    db.promotions,
    db.products,
    db.meta.business.promotionSettings || DEFAULT_PROMOTION_SETTINGS,
  );
  return NextResponse.json(result);
}
