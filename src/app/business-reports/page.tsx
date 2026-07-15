"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Trophy, Layers, Snail, Store as StoreIcon, ArrowRight } from "lucide-react";
import { useFetch, useRole } from "@/lib/client";
import { canSeeProfit, canSeeAllStores } from "@/lib/access";
import type { Role } from "@/lib/auth";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { usd, num } from "@/lib/format";

type Row = { sku: string; name: string; category: string; qty: number; revenue: number; cost: number; profit: number };
type Cat = { category: string; qty: number; revenue: number; cost: number; profit: number; share: number };
type Slow = { sku: string; name: string; category: string; stock: number; qty: number; revenue: number; daysCover: number | null };
type DayS = { date: string; qty: number; revenue: number; cost: number; profit: number; tx: number };
type Data = {
  period: { from: string; to: string };
  totals: { qty: number; revenue: number; cost: number; profit: number; tx: number };
  bestSellers: Row[];
  topProducts: Row[];
  categories: Cat[];
  slowMoving: Slow[];
  today: DayS;
  yesterday: DayS;
  showProfit: boolean;
};

const toKey = (dt: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

export default function BusinessReportsPage() {
  const role = useRole();
  const showProfit = role == null || canSeeProfit(role);
  const today = toKey(new Date());
  const yesterday = toKey(new Date(Date.now() - 86_400_000));

  const [from, setFrom] = useState(() => toKey(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [topN, setTopN] = useState(10);

  const presets = [
    { label: "Today", days: 1 },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ];
  const applyPreset = (n: number) => {
    setTo(today);
    setFrom(toKey(new Date(Date.now() - (n - 1) * 86_400_000)));
  };
  const activePreset = to === today ? presets.find((p) => from === toKey(new Date(Date.now() - (p.days - 1) * 86_400_000)))?.days ?? 0 : 0;

  const qs = `from=${from}&to=${to}&day=${today}&prevDay=${yesterday}`;
  const { data, loading, error } = useFetch<Data>(`/api/reports/business?${qs}`);
  const n = Math.max(1, Math.min(100, topN || 1));

  return (
    <>
      <PageHeader title="Business Reports" subtitle="Best sellers, category performance, slow movers and store comparison" />

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {presets.map((p) => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activePreset === p.days ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5 text-xs font-medium text-slate-500">
          <div>
            <span className="mb-1 block">From</span>
            <DatePicker value={from} max={to} onChange={setFrom} />
          </div>
          <div>
            <span className="mb-1 block">To</span>
            <DatePicker value={to} min={from} max={today} onChange={setTo} />
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Show top … SKUs</span>
          <input
            type="number"
            min={1}
            max={100}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            onWheel={(e) => e.currentTarget.blur()}
            className="input !w-28 !py-2 text-sm"
          />
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data ? (
        <div className="grid h-60 place-items-center">
          <Spinner label="Loading reports…" />
        </div>
      ) : !data ? null : (
        <div className="space-y-6">
          {/* Period totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Revenue" value={usd(data.totals.revenue)} icon={<TrendingUp size={18} />} accent="brand" />
            <StatCard label="Items sold" value={num(data.totals.qty)} icon={<Layers size={18} />} accent="violet" />
            {showProfit && <StatCard label="Profit" value={usd(data.totals.profit)} icon={<Trophy size={18} />} accent="emerald" />}
            <StatCard label="Transactions" value={num(data.totals.tx)} icon={<ArrowRight size={18} />} accent="amber" />
          </div>

          {/* Yesterday vs Today */}
          <DayCompare today={data.today} yesterday={data.yesterday} showProfit={showProfit} />

          {/* Best sellers + Top products */}
          <div className="grid gap-6 lg:grid-cols-2">
            <RankTable
              title={`Best Sellers — top ${n}`}
              subtitle="Most units sold in the period"
              icon={<Trophy size={16} className="text-amber-500" />}
              rows={data.bestSellers.slice(0, n)}
              metric="qty"
              showProfit={showProfit}
            />
            <RankTable
              title={`Top Products — top ${n}`}
              subtitle="Highest revenue in the period"
              icon={<TrendingUp size={16} className="text-brand-500" />}
              rows={data.topProducts.slice(0, n)}
              metric="revenue"
              showProfit={showProfit}
            />
          </div>

          {/* Category performance */}
          <CategoryPerformance categories={data.categories} showProfit={showProfit} />

          {/* Slow moving */}
          <SlowMoving rows={data.slowMoving.slice(0, n)} n={n} />

          {/* Store performance — owner + management only */}
          {role != null && canSeeAllStores(role) && <StorePerformance />}
        </div>
      )}
    </>
  );
}

function Delta({ curr, prev, money }: { curr: number; prev: number; money?: boolean }) {
  const diff = curr - prev;
  const pctDiff = prev > 0 ? (diff / prev) * 100 : curr > 0 ? 100 : 0;
  const up = diff >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? "text-emerald-600" : "text-rose-500"}`}>
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {up ? "+" : ""}
      {money ? usd(diff) : num(diff)} ({prev > 0 ? `${up ? "+" : ""}${Math.round(pctDiff)}%` : "—"})
    </span>
  );
}

function DayCompare({ today, yesterday, showProfit }: { today: DayS; yesterday: DayS; showProfit: boolean }) {
  const cell = (label: string, t: number, y: number, money?: boolean) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink-900">{money ? usd(t) : num(t)}</p>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>Yest. {money ? usd(y) : num(y)}</span>
        <Delta curr={t} prev={y} money={money} />
      </div>
    </div>
  );
  return (
    <Card title="Yesterday vs Today" subtitle={`${today.date} vs ${yesterday.date}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cell("Revenue", today.revenue, yesterday.revenue, true)}
        {cell("Items sold", today.qty, yesterday.qty)}
        {showProfit && cell("Profit", today.profit, yesterday.profit, true)}
        {cell("Transactions", today.tx, yesterday.tx)}
      </div>
    </Card>
  );
}

function RankTable({
  title,
  subtitle,
  icon,
  rows,
  metric,
  showProfit,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: Row[];
  metric: "qty" | "revenue";
  showProfit: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => (metric === "qty" ? r.qty : r.revenue)));
  return (
    <Card title={title} subtitle={subtitle} icon={icon}>
      {rows.length === 0 ? (
        <EmptyState title="No sales in this period" />
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => {
            const val = metric === "qty" ? r.qty : r.revenue;
            return (
              <div key={r.sku} className="flex items-center gap-3 py-1.5">
                <span className="w-5 shrink-0 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-ink-800">{r.name}</p>
                    <p className="shrink-0 text-[13px] font-bold text-ink-900">
                      {metric === "qty" ? `${num(r.qty)} sold` : usd(r.revenue)}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${(val / max) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[11px] text-slate-400">
                    <span className="truncate">
                      {r.sku} · {r.category}
                    </span>
                    <span>
                      {metric === "qty" ? usd(r.revenue) : `${num(r.qty)} sold`}
                      {showProfit ? ` · ${usd(r.profit)} profit` : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CategoryPerformance({ categories, showProfit }: { categories: Cat[]; showProfit: boolean }) {
  return (
    <Card title="Category Performance" subtitle="Share of revenue by category" icon={<Layers size={16} className="text-violet-500" />}>
      {categories.length === 0 ? (
        <EmptyState title="No sales in this period" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 text-left">Category</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-left">Share</th>
                {showProfit && <th className="py-2 pl-3 text-right">Profit</th>}
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3 font-medium text-ink-800">{c.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(c.qty)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-900">{usd(c.revenue)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-violet-400" style={{ width: `${c.share}%` }} />
                      </div>
                      <span className="w-9 text-[11px] tabular-nums text-slate-400">{c.share}%</span>
                    </div>
                  </td>
                  {showProfit && <td className="py-2 pl-3 text-right tabular-nums text-emerald-600">{usd(c.profit)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SlowMoving({ rows, n }: { rows: Slow[]; n: number }) {
  return (
    <Card
      title={`Slow-Moving Products — ${n}`}
      subtitle="On-hand items that sold the least (or not at all) in the period"
      icon={<Snail size={16} className="text-rose-500" />}
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing in stock to show" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 text-left">Product</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="py-2 pl-3 text-right">Days of cover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-ink-800">{r.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {r.sku} · {r.category}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-900">{num(r.stock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={r.qty === 0 ? "font-semibold text-rose-500" : "text-slate-600"}>{num(r.qty)}</span>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-slate-500">{r.daysCover == null ? "—" : `${num(r.daysCover)}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Store Performance — cross-store comparison, leadership only.
type StoreRow = {
  id: string;
  name: string;
  products: number;
  staff: number;
  openPOs: number;
  lowStock: number;
  salesTotal: number;
  invValue: number;
  retailValue: number;
};
function StorePerformance() {
  const { data, loading, error } = useFetch<{ stores: StoreRow[]; totals: any }>("/api/all-stores");
  return (
    <Card title="Store Performance" subtitle="All stores at a glance — owner & management only" icon={<StoreIcon size={16} className="text-brand-500" />}>
      {error ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <div className="grid h-24 place-items-center">
          <Spinner label="Loading stores…" />
        </div>
      ) : !data || data.stores.length === 0 ? (
        <EmptyState title="No stores to compare" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 text-left">Store</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Products</th>
                <th className="px-3 py-2 text-right">Low stock</th>
                <th className="px-3 py-2 text-right">Open POs</th>
                <th className="py-2 pl-3 text-right">Inventory value</th>
              </tr>
            </thead>
            <tbody>
              {[...data.stores]
                .sort((a, b) => b.salesTotal - a.salesTotal)
                .map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink-800">{s.name}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-900">{usd(s.salesTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(s.products)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={s.lowStock > 0 ? "font-semibold text-amber-600" : "text-slate-500"}>{num(s.lowStock)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(s.openPOs)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-slate-600">{usd(s.invValue)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
