"use client";

// The customer receipt — shared by the POS "Payment Complete" modal and the
// Invoice Customization preview.
//
// This is a FAITHFUL mirror of what the thermal printer produces (see
// sunmi-app ReceiptCanvas.kt): same order, same wording, same Khmer, same
// columns. The owner checks the slip on screen; if the two drifted apart, that
// check would be worthless.

import type { Sale, ReceiptSettings } from "@/lib/types";
import { usd, rielDue, invoiceDateTime } from "@/lib/format";
import { formatQueue } from "@/lib/queue";
import { localizeQueueCode, type QueueNumberStyle } from "@/lib/khmer";

export type ReceiptBusiness = {
  name?: string;
  nameKhmer?: string;
  vatTin?: string;
  addressKhmer?: string[];
  address?: string;
  phone?: string;
  logo?: string;
  vatRate?: number; // e.g. 0.10 — shown as "Incl. VAT 10%" under the totals
  exchangeRate?: number; // KHR per US$1
  receipt?: ReceiptSettings;
  // Only the number style is needed here: the printed pickup number must be
  // drawn in the same script as the board the customer will be watching.
  queueSettings?: { numberStyle?: string };
  // The store's tills — read by the POS to offer them as a choice.
  posTerminals?: string[];
};

// The Khmer half of every label. Kept in one place so the screen and the printer
// can never disagree about a word.
const KH = {
  invoice: "វិក្កយបត្រ",
  store: "សាខា",
  date: "កាលបរិច្ឆេទ",
  cashier: "អ្នកគិតលុយ",
  till: "ម៉ាស៊ីនគិតលុយ",
  item: "មុខទំនិញ",
  price: "តម្លៃ",
  qty: "ចំនួន",
  total: "សរុប",
  discount: "បញ្ចុះតម្លៃ",
  received: "ប្រាក់ទទួល",
  change: "ប្រាក់អាប់",
  vat: "តម្លៃរួមបញ្ចូលទាំងអាករ",
  rate: "អត្រាប្តូរប្រាក់",
  ticket: "លេខផ្ទាំងហៅ",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const khr = (n: number) => "៛" + Math.round(n).toLocaleString("en-US");

function Rule() {
  return <div className="my-2 border-t border-dashed border-slate-300" />;
}

/** A "label : value" row from the invoice header block. */
function FormRow({ kh, en, value }: { kh: string; en: string; value: string }) {
  return (
    <div className="flex gap-2 text-[12px] leading-snug">
      <span className="w-[46%] shrink-0 text-ink-800">
        {kh} / {en}
      </span>
      <span className="shrink-0 text-ink-800">:</span>
      <span className="min-w-0 flex-1 break-words text-ink-800">{value}</span>
    </div>
  );
}

/** A label on the left, a figure hard right. */
function MoneyRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[12px] ${bold ? "font-bold" : ""}`}>
      <span className="text-ink-800">{label}</span>
      <span className="shrink-0 tabular-nums text-ink-900">{value}</span>
    </div>
  );
}

export function ReceiptCard({ sale, business }: { sale: Sale; business?: ReceiptBusiness }) {
  const r = business?.receipt || {};
  const showVat = !!r.showVat; // default OFF — the totals just note "Incl. VAT x%"
  const showPickup = r.showPickup !== false; // default on
  const vatPct = Math.round((business?.vatRate ?? 0.1) * 100);
  const rate = business?.exchangeRate || 4100;

  const lines = sale.items.map((it) => {
    const lineTotal = round2(it.price * it.qty);
    return {
      key: `${it.productId}-${it.markdownCode || "full"}-${it.unitId || "base"}`,
      name: it.name,
      price: round2(it.unitName && it.unitQty ? lineTotal / it.unitQty : it.price),
      qtyLabel: it.unitName ? `x${it.unitQty} ${it.unitName}` : `x${it.qty}`,
      lineTotal,
      markdownPercent: it.markdownPercent,
    };
  });
  const promoTotal = round2((sale.promotions || []).reduce((n, p) => n + (p.discount || 0), 0));
  const otherOff = round2((sale.discount || 0) - promoTotal);

  const change = sale.change ?? undefined;
  const receivedRiel = sale.cashRiel != null ? Math.max(0, Math.round(sale.cashRiel)) : undefined;
  const receivedUsd = sale.cashUsd != null ? round2(sale.cashUsd + (change || 0)) : undefined;
  const anyCash = receivedUsd != null || receivedRiel != null || change != null;

  const addressLines = business?.addressKhmer?.filter(Boolean).length
    ? business!.addressKhmer!.filter(Boolean)
    : [business?.address, business?.phone].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-[320px] rounded-xl border border-dashed border-slate-200 bg-white p-4 font-sans text-ink-900">
      {/* ---- Header ---- */}
      <div className="text-center">
        {r.showLogo && business?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logo} alt="" className="mx-auto mb-2 max-h-12 object-contain" />
        )}
        <p className="text-[15px] font-bold leading-tight">{business?.nameKhmer || business?.name}</p>
        {business?.vatTin && (
          <p className="text-[10px] leading-snug text-slate-500">
            លេខអត្តសញ្ញាណកម្ម (VATTIN) :{business.vatTin}
          </p>
        )}
        {addressLines.map((l, i) => (
          <p key={i} className="text-[10px] leading-snug text-slate-500">
            {l}
          </p>
        ))}
        {r.headerNote && <p className="mt-1 text-[10px] italic text-slate-500">{r.headerNote}</p>}
        {/* The owner's wording, or the standard title if they never changed it.
            An explicitly BLANK title prints nothing — some stores don't want a
            document heading at all. */}
        {(r.invoiceTitle ?? `${KH.invoice} / COMMERCIAL INVOICE`) && (
          <p className="mt-2 text-[12px]">{r.invoiceTitle ?? `${KH.invoice} / COMMERCIAL INVOICE`}</p>
        )}
      </div>

      {/* ---- Who / when / where ---- */}
      <div className="mt-2 space-y-0.5">
        <FormRow kh={KH.store} en="Store" value={business?.name || ""} />
        <FormRow kh={KH.date} en="Date" value={invoiceDateTime(sale.createdAt)} />
        {sale.cashier && <FormRow kh={KH.cashier} en="Cashier" value={sale.cashier} />}
        <FormRow kh={KH.invoice} en="Invoice Number" value={sale.invoiceNo || sale.id} />
        {sale.posTerminalId && <FormRow kh={KH.till} en="Till" value={sale.posTerminalId} />}
      </div>
      {/* A named customer prints; an unnamed one prints nothing. A "WALK-IN"
          banner on nearly every slip is a line of paper that tells no one
          anything. */}
      {sale.customerName && (
        <p className="mt-2 text-center text-[12px] font-bold">{sale.customerName.toUpperCase()}</p>
      )}

      {/* ---- Items ---- */}
      <Rule />
      <div className="flex gap-2 text-[10px] leading-tight text-slate-500">
        <span className="min-w-0 flex-1">{KH.item}</span>
        <span className="w-14 shrink-0 text-right">{KH.price}</span>
        <span className="w-12 shrink-0 text-right">{KH.qty}</span>
        <span className="w-14 shrink-0 text-right">{KH.total}</span>
      </div>
      <div className="flex gap-2 text-[11px] leading-tight">
        <span className="min-w-0 flex-1">Item Name</span>
        <span className="w-14 shrink-0 text-right">Price</span>
        <span className="w-12 shrink-0 text-right">QTY</span>
        <span className="w-14 shrink-0 text-right">Total</span>
      </div>
      <Rule />
      <div className="space-y-1.5">
        {lines.map((l) => (
          <div key={l.key} className="flex gap-2 text-[11px] leading-snug">
            <span className="min-w-0 flex-1 break-words">
              {l.name}
              {l.markdownPercent != null && <span className="ml-1 font-bold text-amber-600">-{l.markdownPercent}%</span>}
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums">{usd(l.price)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums">{l.qtyLabel}</span>
            <span className="w-14 shrink-0 text-right tabular-nums">{usd(l.lineTotal)}</span>
          </div>
        ))}
      </div>

      {/* ---- Money ---- */}
      <Rule />
      {/* No Sub Total row: with no discount it just repeats the total one line
          above it. Deals and discounts still print — those are the only reason
          the total differs from the items. */}
      <div className="space-y-1">
        {(sale.promotions || []).map((p) => (
          <MoneyRow key={p.code} label={p.name} value={`-${usd(p.discount)}`} />
        ))}
        {otherOff > 0.005 && <MoneyRow label={`${KH.discount} / Discount`} value={`-${usd(otherOff)}`} />}
        {showVat && <MoneyRow label="Subtotal (ex VAT)" value={usd(sale.subtotal)} />}
        {showVat && <MoneyRow label="VAT" value={usd(sale.tax)} />}
      </div>
      <div className="mt-2 space-y-1">
        <MoneyRow label={`${KH.total} / TOTAL (USD)`} value={usd(sale.total)} bold />
        <MoneyRow label={`${KH.total} / TOTAL (KHR)`} value={rielDue(sale.total)} bold />
      </div>

      {/* ---- Cash ---- */}
      <Rule />
      <div className="space-y-1">
        {anyCash ? (
          <>
            {receivedUsd != null && receivedUsd > 0.005 && (
              <MoneyRow label={`${KH.received} / Received (USD)`} value={usd(receivedUsd)} />
            )}
            {receivedRiel != null && receivedRiel > 0 && (
              <MoneyRow label={`${KH.received} / Received (KHR)`} value={khr(receivedRiel)} />
            )}
            {change != null && <MoneyRow label={`${KH.change} / Change Given (USD)`} value={usd(change)} />}
          </>
        ) : (
          <MoneyRow label="Paid by" value={sale.paymentMethod} />
        )}
      </div>

      {/* ---- Footer notes ---- */}
      <p className="mt-3 text-center text-[10px] leading-snug text-slate-500">
        {KH.vat} /Incl. VAT {vatPct}%
      </p>
      <p className="text-center text-[10px] leading-snug text-slate-500">
        {KH.rate} / Exchange Rate $1 = KHR {rate}៛
      </p>

      {showPickup && sale.queueNumber != null && (
        <div className="mt-3 text-center">
          {/* The code the BOARD calls, drawn the way the board draws it — the
              customer matches this against the TV, so the two must agree. */}
          <p className="text-4xl font-extrabold leading-none tracking-tight">
            {localizeQueueCode(
              sale.queueCode || formatQueue(sale.queueNumber),
              (business?.queueSettings?.numberStyle as QueueNumberStyle) || "latin",
            )}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">{KH.ticket}/TICKET</p>
        </div>
      )}

      {r.footerNote && <p className="mt-3 text-center text-[11px] font-bold">{r.footerNote}</p>}
    </div>
  );
}
