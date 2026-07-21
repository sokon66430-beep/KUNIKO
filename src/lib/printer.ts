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

export type ReceiptLine = {
  name: string;
  qtyLabel: string; // "2 × Case" or "3"
  lineTotal: number; // USD
};

export type ReceiptPayload = {
  store: { name: string; address?: string; phone?: string };
  invoiceNo: string;
  dateTime: string; // already formatted for the shop
  cashier?: string;
  items: ReceiptLine[];
  discount: number;
  subtotal: number; // ex-VAT value of what's paid
  vat: number;
  total: number;
  totalRiel: number; // total in riel, for the footer
  payment: string;
  tendered?: number;
  change?: number;
  customer?: string;
  queueNumber?: number | null;
  footerNote?: string;
  openDrawer: boolean; // pop the cash drawer (cash sales)
};

type Bridge = {
  printReceipt?: (json: string) => void;
  openDrawer?: () => void;
  version?: () => string;
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
  business: { name?: string; address?: string; phone?: string } | undefined,
  opts: { dateTime: string; rielTotal: number; footerNote?: string },
): ReceiptPayload {
  const items: ReceiptLine[] = sale.items.map((it) => ({
    name: it.name,
    qtyLabel: it.unitName ? `${it.unitQty} × ${it.unitName}` : `${it.qty}`,
    lineTotal: round2(it.price * it.qty),
  }));
  return {
    store: { name: business?.name || "Stookii", address: business?.address, phone: business?.phone },
    invoiceNo: sale.invoiceNo || sale.id,
    dateTime: opts.dateTime,
    items,
    discount: round2(sale.discount || 0),
    subtotal: round2(sale.subtotal || 0),
    vat: round2(sale.tax || 0),
    total: round2(sale.total || 0),
    totalRiel: Math.round(opts.rielTotal || 0),
    payment: sale.paymentMethod,
    tendered: sale.tendered != null ? round2(sale.tendered) : undefined,
    change: sale.change != null ? round2(sale.change) : undefined,
    customer: sale.customerName || undefined,
    queueNumber: sale.queueNumber ?? null,
    footerNote: opts.footerNote,
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
