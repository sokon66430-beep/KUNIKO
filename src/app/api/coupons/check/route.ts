import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkCoupon, findCoupon, couponDetail } from "@/lib/coupons";

export const dynamic = "force-dynamic";

/**
 * Is this scanned code a coupon, and is it good for this basket?
 *
 * POST /api/coupons/check  { code, basketTotal }
 *
 * Answers the till so the cashier gets a real message at the moment of the
 * scan. It reserves NOTHING: the coupon is only spent when the sale commits,
 * so a customer who changes their mind still has a valid voucher, and this
 * route can be called as often as the cashier likes.
 *
 * 404 means "not a coupon at all", which is how the till tells an unknown
 * coupon apart from an unknown barcode.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "");
  const basketTotal = Math.max(0, Number(body?.basketTotal) || 0);

  const db = await readDB();
  const coupon = findCoupon(db.coupons || [], code);
  if (!coupon) return NextResponse.json({ error: "That code isn't a coupon." }, { status: 404 });

  const check = checkCoupon(coupon, basketTotal, { storeId: session.storeId });
  if (!check.ok) return NextResponse.json({ ok: false, reason: check.reason }, { status: 200 });

  return NextResponse.json({
    ok: true,
    code: coupon.code,
    name: coupon.name,
    detail: couponDetail(coupon),
    discount: check.discount,
  });
}
