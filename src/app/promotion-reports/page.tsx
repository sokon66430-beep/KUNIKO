"use client";

import { useMemo, useState } from "react";
import { Sparkles, Gift, TrendingDown, Filter } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { Product, Promotion, PromotionUsage } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { usd, num } from "@/lib/format";
import { storeToday } from "@/lib/storetime";

type Tab = "performance" | "discounts";

function monthStart(): string {
  return `${storeToday().slice(0, 7)}-01`;
}

export default function PromotionReportsPage() {
  const [tab, setTab] = useState<Tab>("performance");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(storeToday());
  const [promotionId, setPromotionId] = useState("All");
  const [productId, setProductId] = useState("All");

  const { data: usages, loading } = useFetch<PromotionUsage[]>("/api/promotion-usages?limit=100000");
  const { data: promotions } = useFetch<Promotion[]>("/api/promotions");
  const { data: products } = useFetch<Product[]>("/api/products");

  const catalog = products || [];
  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const filtered = useMemo(
    () =>
      (usages || [])
        .filter((u) => {
          const day = u.at.slice(0, 10);
          return (!from || day >= from) && (!to || day <= to);
        })
        .filter((u) => promotionId === "All" || u.promotionId === promotionId)
        .filter((u) => productId === "All" || u.items.some((i) => i.productId === productId)),
    [usages, from, to, promotionId, productId],
  );

  // --- Performance: one row per promotion ---
  const performance = useMemo(() => {
    const rows = new Map<
      string,
      { name: string; code: string; detail: string; times: number; free: number; discount: number; revenue: number; qty: number }
    >();
    for (const u of filtered) {
      const row = rows.get(u.promotionId) || {
        name: u.promotionName,
        code: u.promotionCode,
        detail: u.detail,
        times: 0,
        free: 0,
        discount: 0,
        revenue: 0,
        qty: 0,
      };
      row.times += 1;
      row.free += u.freeQty;
      row.discount += u.discount;
      row.revenue += u.revenue;
      row.qty += u.qty;
      rows.set(u.promotionId, row);
    }
    return [...rows.entries()]
      .map(([id, r]) => ({
        id,
        ...r,
        discount: Math.round(r.discount * 100) / 100,
        revenue: Math.round(r.revenue * 100) / 100,
      }))
      .sort((a, b) => b.discount - a.discount);
  }, [filtered]);

  // --- Discounts: one row per product ---
  const byProduct = useMemo(() => {
    const rows = new Map<string, { name: string; sku: string; qty: number; free: number; discount: number; promos: Set<string> }>();
    for (const u of filtered) {
      // A usage's discount covers all its items, so split it across them by
      // share of quantity — the alternative (crediting the whole discount to
      // every product) would double-count a bundle across three drinks.
      const totalQty = u.items.reduce((s, i) => s + i.qty, 0) || 1;
      for (const item of u.items) {
        if (productId !== "All" && item.productId !== productId) continue;
        const row = rows.get(item.productId) || {
          name: item.name,
          sku: item.sku,
          qty: 0,
          free: 0,
          discount: 0,
          promos: new Set<string>(),
        };
        row.qty += item.qty;
        row.free += item.freeQty;
        row.discount += (u.discount * item.qty) / totalQty;
        row.promos.add(u.promotionName);
        rows.set(item.productId, row);
      }
    }
    return [...rows.entries()]
      .map(([id, r]) => ({ id, ...r, discount: Math.round(r.discount * 100) / 100, promos: [...r.promos] }))
      .sort((a, b) => b.discount - a.discount);
  }, [filtered, productId]);

  const totalDiscount = Math.round(filtered.reduce((s, u) => s + u.discount, 0) * 100) / 100;
  const totalFree = filtered.reduce((s, u) => s + u.freeQty, 0);
  const totalRevenue = Math.round(filtered.reduce((s, u) => s + u.revenue, 0) * 100) / 100;

  // Only products a deal has actually touched — no point offering the whole
  // catalogue as a filter.
  const productOptions = useMemo(() => {
    const ids = new Set((usages || []).flatMap((u) => u.items.map((i) => i.productId)));
    return [
      { value: "All", label: "Every product" },
      ...[...ids]
        .map((id) => productById.get(id))
        .filter(Boolean)
        .map((p) => ({ value: p!.id, label: p!.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [usages, productById]);

  return (
    <div>
      <PageHeader title="Promotion Reports" subtitle="What the deals gave away, and what they brought in." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Times used" value={num(filtered.length)} sub="deals fired" icon={<Sparkles size={15} />} />
        <StatCard
          label="Discount cost"
          value={usd(totalDiscount)}
          sub="given away"
          icon={<TrendingDown size={15} />}
          accent="rose"
        />
        <StatCard label="Items free" value={num(totalFree)} sub="handed over unpaid" icon={<Gift size={15} />} accent="amber" />
        <StatCard
          label="Sales generated"
          value={usd(totalRevenue)}
          sub="paid on promoted items"
          icon={<Filter size={15} />}
          accent="emerald"
        />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div>
            <label className="label">Promotion</label>
            <Select
              value={promotionId}
              onChange={setPromotionId}
              options={[
                { value: "All", label: "Every promotion" },
                ...(promotions || []).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <div>
            <label className="label">Product</label>
            <Select value={productId} onChange={setProductId} options={productOptions} />
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {(
          [
            { key: "performance", label: "Promotion performance", icon: Sparkles },
            { key: "discounts", label: "Discount report", icon: TrendingDown },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                tab === t.key ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-ink-900"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading && <Spinner label="Loading…" />}

      {!loading && tab === "performance" && (
        <Card>
          {performance.length === 0 ? (
            <EmptyState
              title="No promotion fired in this window"
              hint="Deals appear here the moment a basket qualifies for one."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Promotion</th>
                    <th className="pb-2.5 text-right">Times used</th>
                    <th className="pb-2.5 text-right">Items free</th>
                    <th className="pb-2.5 text-right">Discount cost</th>
                    <th className="pb-2.5 text-right">Sales generated</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <span className="font-semibold text-ink-900">{r.name}</span>
                        <span className="block text-[11.5px] text-slate-400">
                          {r.code} · {r.detail}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-ink-900">{num(r.times)}</td>
                      <td className="py-2.5 text-right tabular-nums text-amber-600">{num(r.free)}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-rose-600">{usd(r.discount)}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-600">{usd(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loading && tab === "discounts" && (
        <Card subtitle="A deal's discount is shared across the items it covered, so a bundle isn't counted three times.">
          {byProduct.length === 0 ? (
            <EmptyState title="No discounts in this window" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Product</th>
                    <th className="pb-2.5">Promotions</th>
                    <th className="pb-2.5 text-right">Sold on deal</th>
                    <th className="pb-2.5 text-right">Given free</th>
                    <th className="pb-2.5 text-right">Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <span className="font-semibold text-ink-900">{r.name}</span>
                        <span className="block text-[11.5px] text-slate-400">{r.sku}</span>
                      </td>
                      <td className="py-2.5 text-[12.5px] text-slate-500">{r.promos.join(", ")}</td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-ink-900">{num(r.qty)}</td>
                      <td className="py-2.5 text-right tabular-nums text-amber-600">{num(r.free)}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-rose-600">{usd(r.discount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
