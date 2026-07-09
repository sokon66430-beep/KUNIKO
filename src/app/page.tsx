"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Receipt,
  AlertTriangle,
  Package,
  ArrowUpRight,
} from "lucide-react";
import { useFetch } from "@/lib/client";
import type { Stats, RangeKey } from "@/lib/analytics";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge } from "@/components/ui";
import { usd, riel, num, pct } from "@/lib/format";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const PIE_COLORS = ["#1f5ff5", "#3380ff", "#59a5ff", "#8ec6ff", "#a78bfa", "#34d399", "#fbbf24"];

export default function DashboardPage() {
  const [range, setRange] = useState<RangeKey>("30d");
  const { data, loading, error } = useFetch<Stats>(`/api/stats?range=${range}`);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of sales, profit and inventory health"
        actions={
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  range === r.key ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {loading && <Spinner label="Loading dashboard…" />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="space-y-6">
          {/* Headline cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Today's Sales"
              value={usd(data.todayRevenue)}
              sub={`${riel(data.todayRevenue)} · ${data.todayTx} sales`}
              icon={<DollarSign size={18} />}
              accent="brand"
            />
            <StatCard
              label={`Revenue (${labelFor(range)})`}
              value={usd(data.revenue)}
              sub={`${data.txCount} transactions`}
              icon={<Receipt size={18} />}
              accent="violet"
            />
            <StatCard
              label={`Profit (${labelFor(range)})`}
              value={usd(data.profit)}
              sub={`${pct(data.margin)} margin`}
              icon={<TrendingUp size={18} />}
              accent="emerald"
            />
            <StatCard
              label="Low Stock Items"
              value={num(data.lowStockCount)}
              sub={`${num(data.productCount)} products tracked`}
              icon={<AlertTriangle size={18} />}
              accent="amber"
            />
          </div>

          {/* Revenue trend */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink-900">Revenue & Profit Trend</h3>
                <p className="text-xs text-slate-500">Daily over the selected period</p>
              </div>
              <div className="flex gap-4 text-xs">
                <Legend color="#1f5ff5" label="Revenue" />
                <Legend color="#34d399" label="Profit" />
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1f5ff5" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#1f5ff5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" stroke="#1f5ff5" strokeWidth={2.5} fill="url(#rev)" />
                  <Area type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={2.5} fill="url(#prof)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Top products */}
            <Card className="lg:col-span-2">
              <h3 className="mb-1 text-base font-bold text-ink-900">Top Products</h3>
              <p className="mb-4 text-xs text-slate-500">By revenue in the selected period</p>
              <div className="space-y-3">
                {data.topProducts.slice(0, 6).map((p, i) => {
                  const max = data.topProducts[0]?.revenue || 1;
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="w-5 text-sm font-bold text-slate-300">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-ink-800">{p.name}</p>
                          <p className="shrink-0 text-sm font-bold text-ink-900">{usd(p.revenue)}</p>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                            style={{ width: `${Math.max(6, (p.revenue / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-slate-400">{num(p.qty)} sold</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Category mix */}
            <Card>
              <h3 className="mb-1 text-base font-bold text-ink-900">Sales by Category</h3>
              <p className="mb-2 text-xs text-slate-500">Share of revenue</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.byCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={75}
                      paddingAngle={2}
                    >
                      {data.byCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip money />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {data.byCategory.slice(0, 5).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {c.name}
                    </span>
                    <span className="font-semibold text-ink-800">{usd(c.value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Low stock */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-bold text-ink-900">Reorder Alerts</h3>
                <Badge tone={data.lowStockCount ? "amber" : "emerald"}>
                  {data.lowStockCount} need restock
                </Badge>
              </div>
              {data.lowStock.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">All stock levels healthy 🎉</p>
              ) : (
                <div className="space-y-2.5">
                  {data.lowStock.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-600">
                        <Package size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.sku} · {p.supplier}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${p.stock === 0 ? "text-rose-600" : "text-amber-600"}`}>
                          {p.stock} {p.unit}
                        </p>
                        <p className="text-[11px] text-slate-400">min {p.reorderLevel}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Peak hours */}
            <Card>
              <h3 className="mb-1 text-base font-bold text-ink-900">Busiest Hours</h3>
              <p className="mb-4 text-xs text-slate-500">Revenue by hour of day</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.peakHours} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={1} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTooltip money />} />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="#3380ff" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Inventory value footer */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MiniStat label="Items Sold" value={num(data.itemsSold)} />
            <MiniStat label="Avg Ticket" value={usd(data.avgTicket)} />
            <MiniStat label="Inventory Value (cost)" value={usd(data.inventoryValue)} />
            <MiniStat label="Inventory Value (retail)" value={usd(data.retailValue)} />
          </div>
        </div>
      )}
    </div>
  );
}

function labelFor(range: RangeKey) {
  return range === "today" ? "today" : range === "7d" ? "7d" : range === "30d" ? "30d" : "90d";
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-500">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex items-center justify-between px-4 py-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm font-bold text-ink-900">{value}</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-soft">
      {label != null && <p className="mb-1 font-semibold text-ink-800">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="capitalize">{p.name}:</span>
          <span className="font-semibold text-ink-900">{usd(p.value)}</span>
        </p>
      ))}
      {money && payload[0]?.payload?.name && (
        <p className="mt-0.5 text-slate-400">{payload[0].payload.name}</p>
      )}
    </div>
  );
}
