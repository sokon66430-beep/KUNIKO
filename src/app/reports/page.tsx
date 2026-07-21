"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, RotateCcw, FileSpreadsheet } from "lucide-react";
import { useFetch, api, useAccess } from "@/lib/client";
import type { Stats, RangeKey } from "@/lib/analytics";
import type { Sale } from "@/lib/types";
import { PageHeader, Card, Spinner, ErrorBox, Badge } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { usd, num, pct, dateTime } from "@/lib/format";
import { canSeeProfit } from "@/lib/access";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const PIE_COLORS = ["#1f5ff5", "#34d399", "#fbbf24", "#a78bfa"];

export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>("30d");
  const { data, loading, error, reload } = useFetch<Stats>(`/api/stats?range=${range}`);
  const { data: sales, reload: reloadSales } = useFetch<Sale[]>("/api/sales?limit=25");
  const [resetting, setResetting] = useState(false);
  const { role, caps } = useAccess();
  const showProfit = role == null || canSeeProfit(role, caps);

  async function resetDemo() {
    if (
      !(await confirmDialog({
        title: "Reset demo data",
        message: "Reset all demo data back to the seeded sample? Your changes will be lost.",
        confirmText: "Reset",
      }))
    )
      return;
    setResetting(true);
    try {
      await api("/api/reset", { method: "POST" });
      reload();
      reloadSales();
    } finally {
      setResetting(false);
    }
  }

  function exportCsv() {
    if (!sales) return;
    const header = ["Invoice", "Date", "Customer", "Payment", "Items", "Subtotal", "Discount", "VAT", "Total"];
    const rows = [
      showProfit ? [...header, "Profit"] : header,
      ...sales.map((s) => {
        const row = [
          s.invoiceNo,
          new Date(s.createdAt).toISOString(),
          s.customerName || "Walk-in",
          s.paymentMethod,
          String(s.items.reduce((a, it) => a + it.qty, 0)),
          s.subtotal.toFixed(2),
          s.discount.toFixed(2),
          s.tax.toFixed(2),
          s.total.toFixed(2),
        ];
        return showProfit ? [...row, s.profit.toFixed(2)] : row;
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monakom-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Sales performance, margins and transaction history"
        actions={
          <div className="flex items-center gap-2">
            {/* Per-product Excel: units sold, revenue, VAT, cost, profit — the
                figures below, for the selected range. */}
            <a className="btn-ghost" href={`/api/reports/products/export?range=${range}`}>
              <FileSpreadsheet size={16} /> Export Excel
            </a>
            <button className="btn-ghost" onClick={exportCsv}>
              <Download size={16} /> Invoices CSV
            </button>
            <button className="btn-ghost" onClick={resetDemo} disabled={resetting}>
              <RotateCcw size={16} /> {resetting ? "Resetting…" : "Reset demo"}
            </button>
          </div>
        }
      />

      <div className="mb-6 flex rounded-xl border border-slate-200 bg-white p-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              range === r.key ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Crunching numbers…" />}

      {data && (
        <div className="space-y-6">
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Gross Revenue" value={usd(data.revenue)} />
            <Kpi label="Net Sales" value={usd(data.netSales)} />
            {showProfit && <Kpi label="Gross Profit" value={usd(data.profit)} tone="emerald" />}
            {showProfit && <Kpi label="Profit Margin" value={pct(data.margin)} tone="emerald" />}
            {showProfit && <Kpi label="Cost of Goods" value={usd(data.cogs)} />}
            <Kpi label="VAT Collected" value={usd(data.tax)} />
            <Kpi label="Discounts Given" value={usd(data.discount)} tone="rose" />
            <Kpi label="Avg. Ticket" value={usd(data.avgTicket)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h3 className="mb-1 text-base font-bold text-ink-900">{showProfit ? "Daily Revenue vs Profit" : "Daily Revenue"}</h3>
              <p className="mb-4 text-xs text-slate-500">{data.txCount} transactions · {num(data.itemsSold)} items</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.series} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]} fill="#1f5ff5" />
                    {showProfit && <Bar dataKey="profit" name="Profit" radius={[3, 3, 0, 0]} fill="#34d399" />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h3 className="mb-1 text-base font-bold text-ink-900">Payment Methods</h3>
              <p className="mb-2 text-xs text-slate-500">Share of total revenue</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.byPayment} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                      {data.byPayment.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<MoneyTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {data.byPayment.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {p.name}
                    </span>
                    <span className="font-semibold text-ink-800">{usd(p.value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Top products table */}
          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-ink-900">Top Products by Revenue</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">#</th>
                    <th className="px-5 py-3 font-semibold">Product</th>
                    <th className="px-5 py-3 text-right font-semibold">Qty Sold</th>
                    <th className="px-5 py-3 text-right font-semibold">Revenue</th>
                    <th className="px-5 py-3 text-right font-semibold">VAT</th>
                    {showProfit && <th className="px-5 py-3 text-right font-semibold">Cost</th>}
                    {showProfit && <th className="px-5 py-3 text-right font-semibold">Profit</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p, i) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-bold text-slate-300">{i + 1}</td>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-ink-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.sku}</p>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{num(p.qty)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-ink-900">{usd(p.revenue)}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{usd(p.vat)}</td>
                      {showProfit && <td className="px-5 py-3 text-right text-slate-500">{usd(p.cost)}</td>}
                      {showProfit && <td className="px-5 py-3 text-right text-emerald-600">{usd(p.profit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Recent transactions */}
          <Card className="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-ink-900">Recent Transactions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Payment</th>
                    <th className="px-5 py-3 text-right font-semibold">Items</th>
                    <th className="px-5 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(sales || []).map((s) => (
                    <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-mono text-xs font-semibold text-brand-600">{s.invoiceNo}</td>
                      <td className="px-5 py-3 text-slate-500">{dateTime(s.createdAt)}</td>
                      <td className="px-5 py-3 text-slate-700">{s.customerName || "Walk-in"}</td>
                      <td className="px-5 py-3">
                        <Badge tone="slate">{s.paymentMethod}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {s.items.reduce((a, it) => a + it.qty, 0)}
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-ink-900">{usd(s.total)}</td>
                    </tr>
                  ))}
                  {(!sales || sales.length === 0) && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                        No transactions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-ink-900";
  return (
    <div className="card px-4 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-soft">
      {label != null && <p className="mb-1 font-semibold text-ink-800">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey || p.name} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name}:</span>
          <span className="font-semibold text-ink-900">{usd(p.value)}</span>
        </p>
      ))}
    </div>
  );
}
