"use client";

import { useMemo, useState } from "react";
import { Boxes, Package, Search, Layers } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { Product, Sale } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { usd, num } from "@/lib/format";
import { storeToday } from "@/lib/storetime";
import { baseUnitName, describeBreakdown, hasPackaging, unitsOf } from "@/lib/sellingUnits";

type Tab = "sales" | "inventory";

function monthStart(): string {
  return `${storeToday().slice(0, 7)}-01`;
}

export default function UnitSalesPage() {
  const [tab, setTab] = useState<Tab>("sales");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(storeToday());
  const [q, setQ] = useState("");

  const { data: sales, loading } = useFetch<Sale[]>("/api/sales?limit=100000");
  const { data: products } = useFetch<Product[]>("/api/products");

  const catalog = products || [];
  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const ql = q.trim().toLowerCase();

  /**
   * How much of each product went out, split by the packaging it was sold in.
   *
   * Read off the sale lines rather than recomputed from today's product record:
   * a case was 24 when it was sold, and if someone later changes it to 12 the
   * history must not silently change with it.
   */
  const rows = useMemo(() => {
    const map = new Map<
      string,
      { name: string; sku: string; base: number; revenue: number; byUnit: Map<string, { qty: number; conversion: number }> }
    >();
    for (const s of sales || []) {
      const day = s.createdAt.slice(0, 10);
      if ((from && day < from) || (to && day > to)) continue;
      for (const it of s.items) {
        const row = map.get(it.productId) || {
          name: it.name,
          sku: it.sku,
          base: 0,
          revenue: 0,
          byUnit: new Map<string, { qty: number; conversion: number }>(),
        };
        row.base += it.qty;
        row.revenue += it.price * it.qty;

        const product = productById.get(it.productId);
        const label = it.unitName || (product ? baseUnitName(product) : "Unit");
        const cur = row.byUnit.get(label) || { qty: 0, conversion: it.conversion || 1 };
        // unitQty when it was sold as a pack; otherwise the base count IS the count.
        cur.qty += it.unitQty ?? it.qty;
        row.byUnit.set(label, cur);
        map.set(it.productId, row);
      }
    }
    return [...map.entries()]
      .map(([id, r]) => ({
        id,
        ...r,
        revenue: Math.round(r.revenue * 100) / 100,
        units: [...r.byUnit.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.conversion - a.conversion),
      }))
      .filter((r) => !ql || r.name.toLowerCase().includes(ql) || r.sku.toLowerCase().includes(ql))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, from, to, productById, ql]);

  // Only products that actually have packaging — the equivalent breakdown says
  // nothing for a product sold one way.
  const packaged = useMemo(
    () =>
      catalog
        .filter(hasPackaging)
        .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.sku.toLowerCase().includes(ql))
        .sort((a, b) => b.stock - a.stock),
    [catalog, ql],
  );

  const totalBase = rows.reduce((s, r) => s + r.base, 0);
  const totalRevenue = Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100;

  return (
    <div>
      <PageHeader
        title="Selling Units"
        subtitle="What went out in each packaging, and what the shelf holds — all off one stock balance."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Products sold" value={num(rows.length)} icon={<Package size={15} />} />
        <StatCard label="Units moved" value={num(totalBase)} sub="in base units" icon={<Boxes size={15} />} accent="violet" />
        <StatCard label="Revenue" value={usd(totalRevenue)} icon={<Layers size={15} />} accent="emerald" />
        <StatCard
          label="With packaging"
          value={num(catalog.filter(hasPackaging).length)}
          sub="sold in packs or cases"
          icon={<Boxes size={15} />}
          accent="amber"
        />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div>
            <label className="label">Product</label>
            <div className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-slate-200">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or item ID…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {(
          [
            { key: "sales", label: "Product sales by unit", icon: Package },
            { key: "inventory", label: "Inventory equivalent", icon: Boxes },
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

      {!loading && tab === "sales" && (
        <Card subtitle="Counted as it was sold — a case that held 24 then still counts as 24, whatever it holds today.">
          {rows.length === 0 ? (
            <EmptyState title="Nothing sold in this window" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Product</th>
                    <th className="pb-2.5">Sold as</th>
                    <th className="pb-2.5 text-right">Base units</th>
                    <th className="pb-2.5 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <span className="font-semibold text-ink-900">{r.name}</span>
                        <span className="block text-[11.5px] text-slate-400">{r.sku}</span>
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap gap-1.5">
                          {r.units.map((u) => (
                            <span
                              key={u.name}
                              className={`chip ${u.conversion > 1 ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}
                            >
                              {num(u.qty)} × {u.name}
                              {u.conversion > 1 && ` (${u.conversion})`}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-ink-900">{num(r.base)}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-600">{usd(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loading && tab === "inventory" && (
        <Card subtitle="One balance, shown two ways. The base count is the truth; the breakdown is for whoever is counting the shelf.">
          {packaged.length === 0 ? (
            <EmptyState
              title="No product has packaging yet"
              hint="Add a pack or a case to a product in Products or Inventory, and it shows up here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Product</th>
                    <th className="pb-2.5">Sells as</th>
                    <th className="pb-2.5 text-right">Available</th>
                    <th className="pb-2.5 text-right">Equivalent</th>
                  </tr>
                </thead>
                <tbody>
                  {packaged.map((p) => {
                    const units = unitsOf(p);
                    const base = baseUnitName(p);
                    return (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5">
                          <span className="font-semibold text-ink-900">{p.name}</span>
                          <span className="block text-[11.5px] text-slate-400">{p.sku}</span>
                        </td>
                        <td className="py-2.5">
                          <span className="flex flex-wrap gap-1.5">
                            {units.map((u) => (
                              <span
                                key={u.id}
                                className={`chip ${u.active ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-400 line-through"}`}
                              >
                                {u.name} {u.conversion > 1 && `×${u.conversion}`} · {usd(u.price)}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td
                          className={`py-2.5 text-right font-bold tabular-nums ${p.stock < 0 ? "text-rose-600" : "text-ink-900"}`}
                        >
                          {num(p.stock)} {base.toLowerCase()}
                          {p.stock === 1 ? "" : "s"}
                        </td>
                        <td className="py-2.5 text-right text-[12.5px] text-slate-500">
                          {describeBreakdown(p.stock, units) || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
