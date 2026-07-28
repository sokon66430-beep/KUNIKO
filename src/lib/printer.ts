// Receipt printing bridge.
//
// A web page can't reach a Sunmi's built-in thermal printer, so when Stookii is
// running INSIDE the companion Android app (the "Stookii Printer" wrapper) that
// app injects `window.StookiiPrinter`. We hand it a plain-JSON receipt and it
// prints on the built-in printer + pops the cash drawer via the Sunmi SDK.
//
// Off a Sunmi (plain browser) the bridge is absent — callers fall back to the
// browser's own print, or just skip printing. Keep the payload a simple shape so
// the native side (and any future bridge) can render it without app changes.

import type { Sale } from "./types";
import { rielShelfPrice } from "./format";
import { optionsLabel } from "./options";

export type ReceiptLine = {
  name: string;
  qtyLabel: string; // "2 × Case" or "3"
  options?: string; // "Spicy level: 5" — printed under the line for the customer
  price: number; // USD, per unit sold — the "Price" column
  lineTotal: number; // USD
  lineRiel: number; // KHR, rounded up to the nearest 100 (shelf-price rounding)
};

export type ReceiptPayload = {
  // The store's identity, in both scripts. A Cambodian commercial invoice is
  // headed in Khmer — the trading name, the VAT registration number and the
  // address — so those travel alongside the English ones the back office uses.
  store: {
    name: string;
    nameKhmer?: string;
    vatTin?: string;
    addressKhmer?: string[];
    address?: string;
    phone?: string;
  };
  invoiceNo: string;
  dateTime: string; // already formatted for the shop
  cashier?: string; // who served the customer
  till?: string; // which till rang it up ("POS 1")
  items: ReceiptLine[];
  // Promotion lines, mirrored from the on-screen receipt (name + amount off).
  promotions?: { name: string; detail?: string; discount: number }[];
  discount: number;
  subtotal: number; // ex-VAT value of what's paid
  vat: number;
  total: number;
  totalRiel: number; // total in riel, for the footer
  payment: string;
  tendered?: number;
  change?: number;
  // Cash split by currency, so the slip can say what the customer actually
  // handed over ("Received (KHR) ៛2,000") rather than a converted figure.
  receivedUsd?: number;
  receivedRiel?: number;
  changeRiel?: number;
  exchangeRate?: number; // KHR per US$1, printed in the footer note
  customer?: string;
  queueNumber?: number | null;
  // The full pickup code ("A001") — what the TV calls the customer by. The paper
  // must say the same thing as the board, so send the code and let the bare
  // number stay only as a fallback for a sale rung up before codes existed.
  queueCode?: string;
  // Invoice Customization — the printed receipt follows the same design the
  // owner set on the Invoice Customization screen, exactly like the on-screen
  // receipt does.
  logo?: string; // data-URL image, printed at the top (when Show logo is on)
  // Sent only when the owner has set one. Absent = the printer uses its
  // standard title; present-but-empty = print no title at all.
  invoiceTitle?: string;
  headerNote?: string;
  footerNote?: string;
  showVat?: boolean; // false (the screen default) = just the total + "Includes VAT x%"
  showPickup?: boolean;
  // A CANCELLED invoice. Present = print the void format instead of a receipt:
  // a boxed CANCELLED title, the money shown as refunded, who approved it and
  // why, and no pickup number — there is nothing left to collect.
  cancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  vatPct?: number; // e.g. 10 — for the "Includes VAT 10%" note
  openDrawer: boolean; // pop the cash drawer (cash sales)
};

type Bridge = {
  printReceipt?: (json: string) => void;
  printSlip?: (json: string) => void; // generic slip (safe drop, shift close…)
  openDrawer?: () => void;
  version?: () => string;
};

// A generic cash/till slip (Safe Drop, Bank Transfer, Shift Close, Shift Survey).
// Unlike a sales receipt it has no items/VAT — just a titled list of rows — so it
// gets its own simple shape the native side renders line by line.
export type SlipLine =
  | { t: "hr" }
  | { t: "sec"; a: string } // a section heading
  | { t: "row"; a: string; b: string; big?: boolean } // label + value
  | { t: "center"; a: string } // centred note / verdict
  | { t: "left"; a: string } // small left-aligned note
  | { t: "sig"; a: string }; // a signature line ("Dropped by ____")

export type SlipPayload = {
  store: { name?: string; contact?: string };
  title: string;
  subtitle?: string;
  lines: SlipLine[];
  openDrawer?: boolean;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { StookiiPrinter?: Bridge }).StookiiPrinter ?? null;
}

/** True when running inside the companion app (a real thermal printer is available). */
export function hasThermalPrinter(): boolean {
  return typeof bridge()?.printReceipt === "function";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildReceiptPayload(
  sale: Sale,
  business:
    | {
        name?: string;
        // The store's own name (the branch), served by /api/business.
        storeName?: string;
        nameKhmer?: string;
        vatTin?: string;
        addressKhmer?: string[];
        address?: string;
        phone?: string;
        logo?: string;
        vatRate?: number;
        exchangeRate?: number;
        receipt?: {
          invoiceTitle?: string;
          headerNote?: string;
          footerNote?: string;
          showLogo?: boolean;
          showVat?: boolean;
          showPickup?: boolean;
        };
      }
    | undefined,
  opts: { dateTime: string; rielTotal: number; footerNote?: string; cancelledAt?: string },
): ReceiptPayload {
  const items: ReceiptLine[] = sale.items.map((it) => {
    const lineTotal = round2(it.price * it.qty);
    return {
      name: it.name,
      // What the customer asked for — printed under the line, so the paper and
      // the kitchen ticket say the same thing.
      options: optionsLabel(it.options) || undefined,
      // The Price column shows what ONE of the thing sold costs, so a case line
      // prices the case — the qty column already says how many.
      price: round2(it.unitName && it.unitQty ? lineTotal / it.unitQty : it.price),
      qtyLabel: it.unitName ? `x${it.unitQty} ${it.unitName}` : `x${it.qty}`,
      lineTotal,
      lineRiel: rielShelfPrice(lineTotal),
    };
  });
  // Same rules as the on-screen ReceiptCard, so the paper receipt matches the
  // design on the Invoice Customization screen exactly.
  const r = business?.receipt || {};
  const promotions = (sale.promotions || []).map((p) => ({
    name: p.name,
    detail: p.detail || undefined,
    discount: round2(p.discount || 0),
  }));
  const rate = business?.exchangeRate || 4100;
  const change = sale.change != null ? round2(sale.change) : undefined;
  // What the customer physically handed over, per currency. The sale records the
  // riel notes it took (cashRiel) and the NET dollars after change (cashUsd), so
  // the dollars received are the net plus whatever went back.
  const receivedRiel = sale.cashRiel != null ? Math.max(0, Math.round(sale.cashRiel)) : undefined;
  const receivedUsd = sale.cashUsd != null ? round2(sale.cashUsd + (change || 0)) : undefined;
  return {
    store: {
      // The BRANCH — same source the screen receipt and customer screen use.
      name: business?.storeName || business?.name || "Stookii",
      nameKhmer: business?.nameKhmer || undefined,
      vatTin: business?.vatTin || undefined,
      addressKhmer: business?.addressKhmer?.filter(Boolean),
      address: business?.address,
      phone: business?.phone,
    },
    invoiceNo: sale.invoiceNo || sale.id,
    dateTime: opts.dateTime,
    // Both stamped on the sale itself, so a reprint names the till and the
    // person who actually served the customer — not today's device and operator.
    cashier: sale.cashier || undefined,
    till: sale.posTerminalId || undefined,
    items,
    promotions: promotions.length ? promotions : undefined,
    discount: round2(sale.discount || 0),
    subtotal: round2(sale.subtotal || 0),
    vat: round2(sale.tax || 0),
    total: round2(sale.total || 0),
    // Riel total rounded UP to the nearest 100 — no odd 27,880, it shows 27,900.
    totalRiel: rielShelfPrice(round2(sale.total || 0)),
    payment: sale.paymentMethod,
    tendered: sale.tendered != null ? round2(sale.tendered) : undefined,
    change,
    receivedUsd,
    receivedRiel,
    // Change always goes back in dollars at this till, so the riel change line
    // only appears if that ever changes.
    changeRiel: undefined,
    exchangeRate: rate,
    customer: sale.customerName || undefined,
    queueNumber: sale.queueNumber ?? null,
    queueCode: sale.queueCode || undefined,
    logo: r.showLogo && business?.logo ? business.logo : undefined,
    // Sent only when the owner has actually set one, so the printer can tell
    // "never configured" (use the standard title) from "deliberately blank".
    invoiceTitle: r.invoiceTitle,
    headerNote: r.headerNote || undefined,
    footerNote: r.footerNote || opts.footerNote,
    showVat: !!r.showVat, // screen default: off
    showPickup: r.showPickup !== false, // screen default: on
    cancelled: sale.cancelled || undefined,
    cancelledAt: sale.cancelledAt ? opts.cancelledAt || sale.cancelledAt : undefined,
    cancelledBy: sale.cancelledBy || undefined,
    cancelReason: sale.cancelReason || undefined,
    vatPct: Math.round((business?.vatRate ?? 0.1) * 100),
    openDrawer: sale.paymentMethod === "Cash",
  };
}

/**
 * Print a sale's receipt on the built-in Sunmi printer via the companion app.
 * Returns true if the native printer handled it; false if no printer is present
 * (the caller can then fall back to the browser or skip).
 */
export function printThermalReceipt(payload: ReceiptPayload): boolean {
  const b = bridge();
  if (!b?.printReceipt) return false;
  try {
    b.printReceipt(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** True when the companion app can print a generic slip (newer app versions). */
export function hasThermalSlip(): boolean {
  return typeof bridge()?.printSlip === "function";
}

/**
 * Print a generic cash/till slip on the built-in printer. Returns true if the
 * native printer handled it; false if there's no printer (or an older companion
 * app without slip support) so the caller can fall back to the on-screen slip.
 */
export function printThermalSlip(payload: SlipPayload): boolean {
  const b = bridge();
  if (!b?.printSlip) return false;
  try {
    b.printSlip(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Pop the cash drawer on its own (e.g. a "no sale" open). */
export function openCashDrawer(): boolean {
  const b = bridge();
  if (!b?.openDrawer) return false;
  try {
    b.openDrawer();
    return true;
  } catch {
    return false;
  }
}
