import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { currentActor } from "@/lib/actor";
import { canManagePromotions } from "@/lib/access";
import { couponCode, findCoupon, normalizeCode } from "@/lib/coupons";
import type { Coupon } from "@/lib/types";

export const dynamic = "force-dynamic";

// The store's coupon book.
//   GET    /api/coupons        → every coupon, newest first
//   POST   /api/coupons        → create one (code generated unless supplied)
//   PATCH  /api/coupons        → edit / stop one
// Reading is open to any signed-in user (the till checks a scan); writing is
// gated to whoever may manage promotions, because a coupon is money.

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = await readDB();
  return NextResponse.json({
    coupons: [...(db.coupons || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}

function readBody(body: any) {
  const pct = Number(body?.discountPercent) || 0;
  const amt = Number(body?.discountAmount) || 0;
  return {
    name: String(body?.name || "").trim().slice(0, 60),
    // A coupon is either a percentage or an amount, never both — two discounts
    // on one voucher is a question nobody at a counter should have to answer.
    discountPercent: pct > 0 ? Math.min(100, pct) : undefined,
    discountAmount: pct > 0 ? undefined : amt > 0 ? Math.round(amt * 100) / 100 : undefined,
    maxDiscount: pct > 0 && Number(body?.maxDiscount) > 0 ? Math.round(Number(body.maxDiscount) * 100) / 100 : undefined,
    minSpend: Number(body?.minSpend) > 0 ? Math.round(Number(body.minSpend) * 100) / 100 : undefined,
    startDate: String(body?.startDate || "").slice(0, 10),
    endDate: String(body?.endDate || "").slice(0, 10),
    singleUse: body?.singleUse !== false, // safe direction: a voucher is one-time unless said otherwise
    active: body?.active !== false,
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManagePromotions(session.role)) {
    return NextResponse.json({ error: "You don't have permission to create coupons" }, { status: 403 });
  }
  const actor = await currentActor();
  const body = await req.json().catch(() => ({}));
  const v = readBody(body);
  if (!v.name) return NextResponse.json({ error: "Give the coupon a name" }, { status: 400 });
  if (!v.discountAmount && !v.discountPercent) {
    return NextResponse.json({ error: "Set an amount or a percentage off" }, { status: 400 });
  }
  if (!v.startDate || !v.endDate) return NextResponse.json({ error: "Set the valid dates" }, { status: 400 });
  if (v.endDate < v.startDate) return NextResponse.json({ error: "The end date is before the start date" }, { status: 400 });

  // How many to print. A campaign is one code on many leaflets (count 1, not
  // single-use); a book of vouchers is many codes (count N, single-use).
  const count = Math.min(500, Math.max(1, Math.round(Number(body?.count) || 1)));
  const supplied = normalizeCode(String(body?.code || ""));

  const result = await mutateDB((db) => {
    if (supplied && count > 1) return { error: "A supplied code can only make one coupon" as const };
    if (supplied && findCoupon(db.coupons, supplied)) {
      return { error: `Coupon ${supplied} already exists` as const };
    }
    const at = new Date().toISOString();
    const made: Coupon[] = [];
    for (let i = 0; i < count; i++) {
      // A supplier's voucher keeps the barcode already printed on it; ours gets
      // the next code in the 93… range.
      const code = supplied || couponCode(db.meta.nextCoupon++);
      if (!supplied && findCoupon(db.coupons, code)) continue; // never reuse a code
      const coupon: Coupon = {
        id: `CPN-${code}`,
        code,
        ...v,
        timesUsed: 0,
        createdBy: actor,
        createdAt: at,
      };
      db.coupons.push(coupon);
      made.push(coupon);
    }
    return { made };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ coupons: result.made });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManagePromotions(session.role)) {
    return NextResponse.json({ error: "You don't have permission to change coupons" }, { status: 403 });
  }
  const actor = await currentActor();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");

  const result = await mutateDB((db) => {
    const c = db.coupons.find((x) => x.id === id);
    if (!c) return { error: "Coupon not found" as const };
    // Switching one off is the common edit and is always allowed. The rest is
    // left alone once it has been spent: rewriting what a redeemed voucher was
    // worth would put the report and the sale at odds.
    if (typeof body.active === "boolean") c.active = body.active;
    if (c.timesUsed === 0) {
      const v = readBody({ ...c, ...body });
      Object.assign(c, v, { active: typeof body.active === "boolean" ? body.active : c.active });
    }
    c.updatedBy = actor;
    c.updatedAt = new Date().toISOString();
    return { coupon: c };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result.coupon);
}
