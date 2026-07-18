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
  Package,
  PackageCheck,
  ChefHat,
  TrendingDown,
} from "lucide-react";
import { useFetch, useAccess } from "@/lib/client";
import type { Stats, RangeKey } from "@/lib/analytics";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge } from "@/components/ui";
import { DateRangePicker } from "@/components/DatePicker";
import { usd, riel, num, pct } from "@/lib/format";
import { canSeeProfit } from "@/lib/access";

// yyyy-mm-dd on the local calendar — the picker's max (can't pick the future)
// and the seed for a nice label.
const localDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const niceDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : iso;
};

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

// Distinct, modern palette for the category donut (top 5 + a neutral "Other").
const CAT_COLORS = ["#6366f1", "#3b82f6", "#06b6d4", "#a855f7", "#ec4899", "#f59e0b"];
const OTHER_COLOR = "#cbd5e1";

// Sales-by-category donut: groups the long tail into "Other" so the ring stays
// clean (never a spiral of slivers), rounds the slice ends, and shows the total
// in the centre with a %-share legend.
function CategoryMix({ categories }: { categories: { name: string; value: number }[] }) {
  const total = categories.reduce((s, c) => s + c.value, 0);
  const top = categories.slice(0, 5).map((c, i) => ({ ...c, color: CAT_COLORS[i % CAT_COLORS.length] }));
  const restVal = categories.slice(5).reduce((s, c) => s + c.value, 0);
  const rows = restVal > 0 ? [...top, { name: "Other", value: restVal, color: OTHER_COLOR }] : top;

  return (
    <Card>
      <h3 className="mb-1 text-base font-bold text-ink-900">Sales by Category</h3>
      <p className="mb-2 text-xs text-slate-500">Share of revenue</p>
      <div className="relative h-52">
        {total > 0 ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={88}
                  paddingAngle={rows.length > 1 ? 3 : 0}
                  cornerRadius={6}
                  stroke="none"
                >
                  {rows.map((r, i) => (
                    <Cell key={i} fill={r.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip money />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Total</span>
              <span className="text-xl font-extrabold tracking-[-0.02em] tabular-nums text-ink-900">{usd(total)}</span>
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-400">No sales yet</div>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r) => {
          const share = total > 0 ? Math.round((r.value / total) * 100) : 0;
          return (
            <div key={r.name} className="flex items-center gap-2.5 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate text-slate-600">{r.name}</span>
              <span className="w-8 text-right tabular-nums text-slate-400">{share}%</span>
              <span className="w-24 text-right font-semibold tabular-nums text-ink-800">{usd(r.value)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<RangeKey>("30d");
  // A specific day picked from the calendar. When set, it overrides the preset
  // range and the dashboard reports just that day — and an optional second
  // date stretches it into a from–to range.
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const url = customDate
    ? `/api/stats?date=${customDate}${customTo ? `&to=${customTo}` : ""}`
    : `/api/stats?range=${range}`;
  const { data, loading, error } = useFetch<Stats>(url);
  const { role, caps } = useAccess();
  const showProfit = role == null || canSeeProfit(role, caps);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of sales, profit and inventory health"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => {
                    setRange(r.key);
                    setCustomDate(null); // a preset clears any picked day/range
                    setCustomTo(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    range === r.key && !customDate ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {/* One calendar: click a day for a single day, or click a start
                then an end day for a range. */}
            <DateRangePicker
              from={customDate ?? ""}
              to={customTo ?? ""}
              max={localDayKey(new Date())}
              onChange={(f, t) => {
                setCustomDate(f || null);
                setCustomTo(t || null);
              }}
            />
          </div>
        }
      />

      {loading && <Spinner label="Loading dashboard…" />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="space-y-6">
          {/* Headline cards.

              They read as one statement about the money: what came in today,
              what was given away, what the customer actually paid, and what's
              left. Low Stock isn't part of that story and has its own section
              below, with the actual items — a bare count up here only asked you
              to scroll.

              The column count follows the card count: Profit is hidden from
              roles that can't see it, and a 4-column grid holding three cards
              leaves a gap that reads as something failed to load. */}
          <div className={`grid grid-cols-2 gap-4 ${showProfit ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <StatCard
              label={
                customDate
                  ? customTo && customTo !== customDate
                    ? `Sales · ${niceDay(customDate)} – ${niceDay(customTo)}`
                    : `Sales · ${niceDay(customDate)}`
                  : SALES_LABEL[range]
              }
              value={usd(data.revenue)}
              sub={`${riel(data.revenue)} · ${num(data.txCount)} sale${data.txCount === 1 ? "" : "s"}`}
              icon={<DollarSign size={18} />}
              accent="brand"
            />
            <StatCard
              label="Discount"
              value={usd(data.discount)}
              // Say where it went. One lump sum can't be acted on: a deal is a
              // rule you can change, a mark down is stock you chose to clear.
              sub={
                data.discount
                  ? `${usd(data.basketDiscount)} deals · ${usd(data.markdownDiscount)} mark downs`
                  : "nothing given away"
              }
              icon={<TrendingDown size={18} />}
              accent="rose"
            />
            <StatCard
              label="After Discount"
              value={usd(data.revenue)}
              sub={`${num(data.txCount)} transaction${data.txCount === 1 ? "" : "s"}`}
              icon={<Receipt size={18} />}
              accent="brand"
            />
            {showProfit && (
              <StatCard
                label="Profit"
                value={usd(data.profit)}
                sub={`${pct(data.margin)} margin`}
                icon={<TrendingUp size={18} />}
                accent="emerald"
              />
            )}
          </div>

          {/* Revenue trend */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink-900">{showProfit ? "Revenue & Profit Trend" : "Revenue Trend"}</h3>
                <p className="text-xs text-slate-500">Daily over the selected period</p>
              </div>
              <div className="flex gap-4 text-xs">
                <Legend color="#2549e8" label="Revenue" />
                {showProfit && <Legend color="#10b981" label="Profit" />}
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2549e8" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2549e8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="revenue" stroke="#2549e8" strokeWidth={2.5} fill="url(#rev)" />
                  {showProfit && <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} fill="url(#prof)" />}
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
                      <span className="w-5 text-sm font-bold tabular-nums text-slate-400">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-ink-800">{p.name}</p>
                          <p className="shrink-0 text-sm font-bold text-ink-900">{usd(p.revenue)}</p>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-500"
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
            <CategoryMix categories={data.byCategory} />
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
                <div className="flex flex-col items-center gap-2.5 py-8 text-center">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                    <PackageCheck size={18} />
                  </div>
                  <p className="text-sm font-medium text-slate-500">All stock levels are healthy</p>
                </div>
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
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="#3b66f5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Inventory value footer */}
          <RecipeInventoryStatus />

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

// The first card's title, and the only one that names the period.
//
// The others dropped their "(yesterday)" suffix: the range picker sits right
// above the row, so repeating it on all five cards said nothing and cost
// everything — "AFTER DISCOUNT (YESTERDAY)" needed three lines where the rest
// took two, which pushed its number below its neighbours' and broke the row's
// straight line.
//
// A Record, not a chain of ternaries: the old chain ended in a bare `: "90d"`,
// so any range it didn't name was labelled 90d — a card confidently reporting
// the wrong period. Now a new range won't compile until it's given a name.
const SALES_LABEL: Record<RangeKey, string> = {
  today: "Today's Sales",
  yesterday: "Yesterday's Sales",
  "7d": "Sales · Last 7 Days",
  "30d": "Sales · Last 30 Days",
  "90d": "Sales · Last 90 Days",
};

type RecipeAlerts = {
  recipeCount: number;
  negative: number;
  low: number;
  items: {
    id: string;
    name: string;
    sku: string;
    stock: number;
    unit: string;
    reorderLevel: number;
    level: "negative" | "low";
    usedBy: string[];
  }[];
};

// Ingredients an active recipe needs that stock can't cover. A negative figure
// isn't a system error — it's a bowl that was served out of stock the system
// didn't know it had, which is exactly what needs looking at.
function RecipeInventoryStatus() {
  const { data } = useFetch<RecipeAlerts>("/api/recipe-alerts");

  // Nothing to say until the store actually uses recipes — no empty widget
  // taking up the dashboard for everyone else.
  if (!data || data.recipeCount === 0) return null;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-bold text-ink-900">Recipe Inventory Status</h3>
        <Badge tone={data.negative ? "rose" : data.low ? "amber" : "emerald"}>
          {data.negative ? `${data.negative} below zero` : data.low ? `${data.low} low` : "All healthy"}
        </Badge>
      </div>
      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 py-8 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <PackageCheck size={18} />
          </div>
          <p className="text-sm font-medium text-slate-500">Every ingredient is covered</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  it.level === "negative" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                }`}
              >
                <ChefHat size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-800">{it.name}</p>
                <p className="truncate text-xs text-slate-400">{it.usedBy.join(", ")}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-bold ${it.level === "negative" ? "text-rose-600" : "text-amber-600"}`}>
                  {it.stock} {it.unit}
                </p>
                <p className="text-[11px] text-slate-400">
                  {it.level === "negative" ? "negative stock" : `min ${it.reorderLevel}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
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
