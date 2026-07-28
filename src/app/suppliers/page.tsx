"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Truck, Search, Package, Phone, ShoppingCart, Users, CalendarClock, Boxes, Trash2 } from "lucide-react";
import { useFetch, useRole, api } from "@/lib/client";
import type { Product, Supplier } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, EmptyState } from "@/components/ui";
import { num } from "@/lib/format";

// Read-only supplier directory. Suppliers are the single source of truth in
// Master Data (owner-only) and mirrored to every store — so there's no add /
// edit / delete here; this page just lists them for ordering and reference.
export default function SuppliersPage() {
  const { data: suppliers, loading, error, reload } = useFetch<Supplier[]>("/api/suppliers");
  const { data: products } = useFetch<Product[]>("/api/products");
  // Master Data's own list, so a row can be told apart from a stray one left in
  // this store's list by an old import.
  const { data: masterSuppliers } = useFetch<Supplier[]>("/api/master/suppliers");
  const role = useRole();
  const isOwner = role === "owner";
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const masterCodes = useMemo(() => new Set((masterSuppliers || []).map((s) => s.code)), [masterSuppliers]);

  async function removeStray(code: string, name: string) {
    const label = name === code ? code : `${name} (${code})`;
    if (!confirm(`Remove "${label}"?\n\nIt isn't in Master Data and no products are linked to it.`)) return;
    setRemoving(code);
    try {
      await api(`/api/suppliers/${encodeURIComponent(code)}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRemoving(null);
    }
  }

  const productCountByCode = useMemo(() => {
    const m = new Map<string, number>();
    (products || []).forEach((p) => {
      if (!p.supplierCode) return;
      m.set(p.supplierCode, (m.get(p.supplierCode) || 0) + 1);
    });
    return m;
  }, [products]);

  const list = suppliers || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [list, query]);

  const withContact = list.filter((s) => s.contactPerson || s.phone).length;
  const linkedProducts = [...productCountByCode.values()].reduce((s, n) => s + n, 0);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Directory of every supplier — managed in Master Data"
        actions={
          isOwner ? (
            <Link href="/master-data" className="btn-ghost">
              <Boxes size={18} /> Manage in Master Data
            </Link>
          ) : undefined
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        Suppliers are controlled centrally in <b className="text-ink-700">Master Data</b> and apply to every store. This
        page is a read-only directory.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Suppliers" value={num(list.length)} icon={<Truck size={18} />} accent="brand" />
        <StatCard label="Products Linked" value={num(linkedProducts)} icon={<Package size={18} />} accent="emerald" />
        <StatCard label="With Contact Info" value={num(withContact)} icon={<Users size={18} />} accent="violet" />
        <StatCard
          label="Avg. Lead Time"
          value={`${Math.round(list.reduce((s, x) => s + (x.leadTime || 0), 0) / (list.length || 1))}d`}
          icon={<CalendarClock size={18} />}
          accent="amber"
        />
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder="Search by name or code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading suppliers…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No suppliers found" />
        ) : (
          <div>
            {filtered.map((s) => {
              const count = productCountByCode.get(s.code) || 0;
              return (
                <div
                  key={s.code}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">
                      {s.name}
                      <span className="ml-2 text-xs font-normal text-slate-400">{s.code}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 truncate text-sm text-slate-500">
                      <span>{s.contactPerson || "—"}</span>
                      {s.phone && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <Phone size={11} /> {s.phone}
                        </span>
                      )}
                      {s.deliverySchedule && <span className="text-slate-400">{s.deliverySchedule}</span>}
                      {s.leadTime ? <span className="text-slate-400">{s.leadTime}d lead</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {count > 0 ? (
                      <Link href={`/inventory?supplier=${encodeURIComponent(s.code)}`}>
                        <Badge tone="brand">{count} products</Badge>
                      </Link>
                    ) : (
                      <Badge tone="slate">0 products</Badge>
                    )}
                    <Link
                      href={`/purchase-orders?supplier=${encodeURIComponent(s.code)}`}
                      title="New PO for this supplier"
                      className="grid h-8 w-8 place-items-center rounded-lg text-brand-600 hover:bg-brand-50"
                    >
                      <ShoppingCart size={16} />
                    </Link>
                    {/* Only ever shown for a STRAY row: not in Master Data and
                        nothing linked to it. Real suppliers are deleted in
                        Master Data, where it propagates to every store. */}
                    {isOwner && count === 0 && !masterCodes.has(s.code) && (
                      <button
                        onClick={() => removeStray(s.code, s.name)}
                        disabled={removing === s.code}
                        title="Remove — not in Master Data and nothing linked to it"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
