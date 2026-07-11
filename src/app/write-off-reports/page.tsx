"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Package, Layers, ListChecks, DollarSign } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { WriteOff } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, EmptyState } from "@/components/ui";
import { num, usd } from "@/lib/format";

type Preset = "today" | "yesterday" | "week" | "month" | "custom";

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function WriteOffReportsPage() {
  const { data, loading, error } = useFetch<WriteOff[]>("/api/write-offs");
  const [preset, setPreset] = useState<Preset>("today");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const range = useMemo(() => {
    const now = new Date();
    const today = dayStart(now).getTime();
    if (preset === "today") return { from: today, to: now.getTime() + 1, label: "Today" };
    if (preset === "yesterday") return { from: today - 86400000, to: today, label: "Yesterday" };
    if (preset === "week") return { from: today - ((now.getDay() + 6) % 7) * 86400000, to: now.getTime() + 1, label: "This week" };
    if (preset === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: now.getTime() + 1, label: "This month" };
    // custom
    const f = start ? new Date(start + "T00:00:00").getTime() : 0;
    const t = end ? new Date(end + "T23:59:59").getTime() : now.getTime() + 1;
    return { from: f, to: t, label: `${start || "start"} → ${end || "today"}` };
  }, [preset, start, end]);

  const rows = useMemo(() => {
    return (data || []).filter((w) => {
      if ((w.status || "Active") === "Cancelled") return false; // cancelled don't count
      const t = new Date(w.createdAt).getTime();
      return t >= range.from && t <= range.to;
    });
  }, [data, range]);

  const totalQty = rows.reduce((s, w) => s + w.quantity, 0);
  const totalValue = rows.reduce((s, w) => s + w.quantity * (w.cost || 0), 0);
  const distinctItems = new Set(rows.map((w) => w.productId)).size;

  const byReason = groupBy(rows, (w) => w.reason);
  const byCategory = groupBy(rows, (w) => w.category || "—");
  const topProducts = Object.values(
    rows.reduce((acc: Record<string, { name: string; qty: number; unit: string; records: number }>, w) => {
      const k = w.productId;
      acc[k] = acc[k] || { name: w.productName, qty: 0, unit: w.unit, records: 0 };
      acc[k].qty += w.quantity;
      acc[k].records += 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const exportUrl = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams({
      from: new Date(range.from).toISOString(),
      to: new Date(range.to).toISOString(),
      note: range.label,
    });
    if (format === "csv") p.set("format", "csv");
    return `/api/write-offs/export?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Write-Off Report"
        subtitle="Filter by period, see the breakdown, and export"
        actions={
          <div className="flex gap-2">
            <a href={exportUrl("csv")} className="btn-ghost">
              <FileText size={18} /> CSV
            </a>
            <a href={exportUrl("xlsx")} className="btn-primary">
              <FileSpreadsheet size={18} /> Excel
            </a>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      {/* Filters */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(["today", "yesterday", "week", "month"] as Preset[]).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${
                  preset === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {p === "week" ? "This Week" : p === "month" ? "This Month" : p}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label">Start date</label>
              <input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); setPreset("custom"); }} />
            </div>
            <div>
              <label className="label">End date</label>
              <input type="date" className="input" value={end} onChange={(e) => { setEnd(e.target.value); setPreset("custom"); }} />
            </div>
            <button
              onClick={() => setPreset("custom")}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${preset === "custom" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Generate
            </button>
          </div>
          <span className="ml-auto text-sm text-slate-500">Showing: <b className="text-ink-700">{range.label}</b></span>
        </div>
      </Card>

      {loading ? (
        <Card><Spinner label="Loading…" /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Quantity" value={num(totalQty)} icon={<Package size={18} />} accent="rose" />
            <StatCard label="Items (distinct)" value={num(distinctItems)} icon={<Layers size={18} />} accent="violet" />
            <StatCard label="Records" value={num(rows.length)} icon={<ListChecks size={18} />} accent="brand" />
            <StatCard label="Value (at cost)" value={usd(totalValue)} icon={<DollarSign size={18} />} accent="amber" />
          </div>

          {rows.length === 0 ? (
            <Card><EmptyState title="No write-offs in this period" hint="Pick a different range." /></Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <BreakdownCard title="By Reason" rows={byReason} total={rows.length} />
              <BreakdownCard title="By Category" rows={byCategory} total={rows.length} />

              <Card className="p-0 lg:col-span-2">
                <div className="border-b border-slate-100 px-5 py-3.5">
                  <h3 className="text-sm font-bold text-ink-900">Top 10 Most Written-Off Products</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2.5 font-semibold">#</th>
                      <th className="px-5 py-2.5 font-semibold">Product</th>
                      <th className="px-5 py-2.5 text-center font-semibold">Records</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p, i) => (
                      <tr key={p.name} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-2.5 text-slate-400">{i + 1}</td>
                        <td className="px-5 py-2.5 font-semibold text-ink-800">{p.name}</td>
                        <td className="px-5 py-2.5 text-center text-slate-600">{p.records}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-rose-600">{num(p.qty)} {p.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function groupBy(rows: WriteOff[], key: (w: WriteOff) => string) {
  const m: Record<string, { count: number; qty: number }> = {};
  for (const w of rows) {
    const k = key(w);
    m[k] = m[k] || { count: 0, qty: 0 };
    m[k].count += 1;
    m[k].qty += w.quantity;
  }
  return Object.entries(m).sort((a, b) => b[1].qty - a[1].qty);
}

function BreakdownCard({ title, rows, total }: { title: string; rows: [string, { count: number; qty: number }][]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r[1].qty));
  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      </div>
      <div className="divide-y divide-slate-50">
        {rows.map(([name, v]) => (
          <div key={name} className="px-5 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-ink-800">{name}</span>
              <span className="text-slate-500">
                <b className="text-ink-800">{num(v.qty)}</b> qty · {v.count} record{v.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v.qty / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
