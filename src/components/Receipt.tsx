"use client";

// The customer receipt body — shared by the POS "Payment Complete" modal and the
// Invoice Customization preview, so what the owner designs is exactly what prints.
// Styling comes from the store's business.receipt settings.

import type { Sale, ReceiptSettings } from "@/lib/types";
import { usd, riel } from "@/lib/format";
import { formatQueue } from "@/lib/queue";
import { Badge } from "@/components/ui";

export type ReceiptBusiness = {
  name?: string;
  address?: string;
  phone?: string;
  logo?: string;
  receipt?: ReceiptSettings;
};

const ACCENT: Record<string, string> = {
  brand: "text-brand-600",
  emerald: "text-emerald-600",
  violet: "text-violet-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
  ink: "text-ink-900",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: "rose" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={tone === "rose" ? "font-semibold text-rose-600" : "font-semibold text-ink-800"}>{value}</span>
    </div>
  );
}

export function ReceiptCard({ sale, business }: { sale: Sale; business?: ReceiptBusiness }) {
  const r = business?.receipt || {};
  const accent = ACCENT[r.accent || "ink"] || ACCENT.ink;
  const showVat = r.showVat !== false; // default on
  const showPickup = r.showPickup !== false; // default on
  const name = business?.name || "Store";
  const contact = [business?.address, business?.phone].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-dashed border-slate-200 p-4">
      <div className="mb-2 text-center">
        {r.showLogo && business?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logo} alt="" className="mx-auto mb-2 max-h-14 object-contain" />
        )}
        <p className={`font-bold ${accent}`}>{name}</p>
        {contact && <p className="text-[11px] text-slate-400">{contact}</p>}
        {r.headerNote && <p className="mt-1 text-[11px] italic text-slate-500">{r.headerNote}</p>}
      </div>

      <div className="space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
        {sale.items.map((it) => (
          <div key={`${it.productId}-${it.markdownCode || "full"}-${it.unitId || "base"}`} className="flex justify-between gap-2">
            <span className="min-w-0 truncate text-slate-600">
              {it.unitName ? `${it.unitQty}× ${it.name} ${it.unitName}` : `${it.qty}× ${it.name}`}
              {it.markdownPercent != null && <span className="ml-1 font-bold text-amber-600">-{it.markdownPercent}%</span>}
              {it.unitName && (
                <span className="block text-[11px] text-slate-400">
                  {it.conversion} {it.name.length > 18 ? "per" : `per ${it.unitName.toLowerCase()}`} · {it.qty} total
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold text-ink-800">{usd(it.price * it.qty)}</span>
          </div>
        ))}
      </div>

      {sale.promotions?.length ? (
        <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2">
          {sale.promotions.map((p) => (
            <div key={p.code} className="flex items-start justify-between gap-2 text-[12px]">
              <span className="min-w-0 text-emerald-700">
                {p.name}
                <span className="block text-[11px] text-slate-400">
                  {p.detail}
                  {p.freeQty > 0 && ` · ${p.freeQty} free`}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-emerald-700">- {usd(p.discount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
        {sale.discount > 0 && <Row label="Items" value={usd(sale.total + sale.discount)} />}
        {sale.discount > 0 && <Row label="Discount" value={`- ${usd(sale.discount)}`} tone="rose" />}
        {showVat && <Row label="Subtotal (ex VAT)" value={usd(sale.subtotal)} />}
        {showVat && <Row label="VAT" value={usd(sale.tax)} />}
        <div className={`flex justify-between pt-1 text-base font-bold ${accent}`}>
          <span>Total</span>
          <span>{usd(sale.total)}</span>
        </div>
        <p className="text-right text-[11px] text-slate-400">{riel(sale.total)}</p>
        {sale.tendered != null && (
          <div className="mt-1 space-y-1 border-t border-dashed border-slate-200 pt-2">
            <Row label="Cash received" value={usd(sale.tendered)} />
            <div className="flex justify-between font-bold text-emerald-700">
              <span>Change</span>
              <span>{usd(sale.change || 0)}</span>
            </div>
            <p className="text-right text-[11px] text-slate-400">{riel(sale.change || 0)}</p>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-slate-200 pt-2 text-xs text-slate-500">
        <span>Paid by {sale.paymentMethod}</span>
        <Badge tone="emerald">{sale.customerName || "Walk-in"}</Badge>
      </div>

      {showPickup && sale.queueNumber != null && (
        <div className="mt-2 flex items-center justify-between border-t border-dashed border-slate-200 pt-2 text-sm">
          <span className="font-semibold text-ink-800">Pickup Number</span>
          <span className="text-lg font-extrabold tabular-nums text-ink-900">{formatQueue(sale.queueNumber)}</span>
        </div>
      )}

      {r.footerNote && (
        <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-center text-[11px] font-medium text-slate-500">
          {r.footerNote}
        </p>
      )}
    </div>
  );
}
