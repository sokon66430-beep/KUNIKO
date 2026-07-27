import type { Coupon, DB } from "./types";
import { storeToday } from "./storetime";

// ---------------------------------------------------------------------------
// Coupons — the voucher a customer hands over, scanned like a product.
//
// Everything here is a PURE decision about one coupon and one basket, so the
// till and the server can ask the same question and never disagree. The till
// asks in order to show the cashier a clear answer at the moment of the scan;
// the server asks again, at commit, because the till's answer is a courtesy and
// the server's is the one that spends money.
//
// The rule that matters most: a single-use coupon is marked spent inside the
// SALE's own write-lock, not when it is scanned. Scanning is not a claim. If
// the sale is abandoned the voucher is still good, and two tills scanning the
// same voucher at the same instant cannot both commit — the second one loses
// the race and is told why.
// ---------------------------------------------------------------------------

const COUPON_PREFIX = "93";

/** 1 → "930000001". Stookii's own range; supplier coupons keep their barcode. */
export function couponCode(seq: number): string {
  return COUPON_PREFIX + String(seq).padStart(7, "0");
}

/**
 * A code in the range Stookii prints.
 *
 * Only used to decide what to GENERATE and to give a better error message —
 * never to decide whether a scan is a coupon, because a supplier's voucher
 * carries whatever barcode its printer used. Lookup is by matching the list.
 */
export function isCouponCode(code: string): boolean {
  return /^93\d{7}$/.test(code.trim());
}

/** Codes are matched case-insensitively and trimmed: they're read off paper. */
export const normalizeCode = (code: string): string => code.trim().toUpperCase();

export function findCoupon(coupons: Coupon[], code: string): Coupon | undefined {
  const q = normalizeCode(code);
  if (!q) return undefined;
  return coupons.find((c) => normalizeCode(c.code) === q);
}

export type CouponCheck =
  | { ok: true; coupon: Coupon; discount: number }
  | { ok: false; reason: string; coupon?: Coupon };

/**
 * What this coupon takes off this basket, or why it can't.
 *
 * `basketTotal` is the gross AFTER promotions and mark-downs. A coupon is the
 * last thing applied, so "20% off" means 20% of what the customer would
 * otherwise have paid — not 20% of a price they were never going to pay.
 *
 * Refusal messages are written for the cashier to read out loud to a customer,
 * which is why they say what is wrong rather than naming a rule.
 */
export function checkCoupon(
  coupon: Coupon | undefined,
  basketTotal: number,
  opts: { today?: string; storeId?: string } = {},
): CouponCheck {
  if (!coupon) return { ok: false, reason: "That coupon isn't in the system." };
  const today = opts.today || storeToday();

  if (!coupon.active) return { ok: false, reason: `${coupon.name} has been stopped.`, coupon };
  if (today < coupon.startDate) {
    return { ok: false, reason: `${coupon.name} isn't valid until ${coupon.startDate}.`, coupon };
  }
  // endDate is the LAST valid day, matching how mark-downs and promotions read.
  if (today > coupon.endDate) {
    return { ok: false, reason: `${coupon.name} expired on ${coupon.endDate}.`, coupon };
  }
  if (coupon.singleUse && coupon.timesUsed > 0) {
    return { ok: false, reason: `That coupon has already been used${coupon.lastUsedAt ? ` (${coupon.lastUsedAt.slice(0, 10)})` : ""}.`, coupon };
  }
  if (opts.storeId && coupon.storeIds?.length && !coupon.storeIds.includes(opts.storeId)) {
    return { ok: false, reason: `${coupon.name} can't be used at this shop.`, coupon };
  }
  if (coupon.minSpend && basketTotal < coupon.minSpend) {
    return {
      ok: false,
      reason: `${coupon.name} needs a basket of $${coupon.minSpend.toFixed(2)} — this one is $${basketTotal.toFixed(2)}.`,
      coupon,
    };
  }

  const discount = couponDiscount(coupon, basketTotal);
  // A coupon that would take off nothing is refused rather than accepted
  // silently: the cashier has to be able to tell the customer something.
  if (discount <= 0) return { ok: false, reason: "There's nothing for that coupon to take off.", coupon };
  return { ok: true, coupon, discount };
}

/**
 * The money off, to the cent, never more than the basket itself.
 *
 * Capping at the basket is what stops a $5 voucher on a $3 basket handing over
 * $2 in change — a coupon is a discount, not a payment.
 */
export function couponDiscount(coupon: Coupon, basketTotal: number): number {
  const gross = Math.max(0, basketTotal);
  let off = 0;
  if (coupon.discountPercent && coupon.discountPercent > 0) {
    off = (gross * Math.min(100, coupon.discountPercent)) / 100;
    if (coupon.maxDiscount && coupon.maxDiscount > 0) off = Math.min(off, coupon.maxDiscount);
  } else if (coupon.discountAmount && coupon.discountAmount > 0) {
    off = coupon.discountAmount;
  }
  return Math.round(Math.min(off, gross) * 100) / 100;
}

/** "20% off, up to $5" / "$2.00 off" — one line for the till and the list. */
export function couponDetail(coupon: Coupon): string {
  if (coupon.discountPercent) {
    const cap = coupon.maxDiscount ? `, up to $${coupon.maxDiscount.toFixed(2)}` : "";
    return `${coupon.discountPercent}% off${cap}`;
  }
  return `$${(coupon.discountAmount || 0).toFixed(2)} off`;
}

export type CouponStatus = "Scheduled" | "Active" | "Expired" | "Used" | "Stopped";

export function couponStatus(c: Coupon, today: string = storeToday()): CouponStatus {
  if (!c.active) return "Stopped";
  if (c.singleUse && c.timesUsed > 0) return "Used";
  if (today < c.startDate) return "Scheduled";
  if (today > c.endDate) return "Expired";
  return "Active";
}

/**
 * Spend the coupon. Call ONLY inside the sale's mutateDB, after checkCoupon has
 * passed against the committed basket.
 */
export function redeemCoupon(
  db: DB,
  coupon: Coupon,
  input: { saleId: string; invoiceNo: string; cashier: string; posTerminalId?: string; basketTotal: number; discount: number; at: string },
): void {
  coupon.timesUsed = (coupon.timesUsed || 0) + 1;
  coupon.lastUsedAt = input.at;
  (db.couponRedemptions ||= []).push({
    id: `CR-${String(db.meta.nextCouponRedemption++).padStart(6, "0")}`,
    at: input.at,
    couponId: coupon.id,
    code: coupon.code,
    name: coupon.name,
    saleId: input.saleId,
    invoiceNo: input.invoiceNo,
    cashier: input.cashier,
    posTerminalId: input.posTerminalId,
    basketTotal: input.basketTotal,
    discount: input.discount,
  });
}
