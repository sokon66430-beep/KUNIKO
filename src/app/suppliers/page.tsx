"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Truck,
  Search,
  Pencil,
  Trash2,
  Package,
  Phone,
  ShoppingCart,
  Users,
  CalendarClock,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { SupplierModal, EMPTY_SUPPLIER } from "@/components/SupplierModal";
import { num } from "@/lib/format";

export default function SuppliersPage() {
  const { data: suppliers, loading, error, reload } = useFetch<Supplier[]>("/api/suppliers");
  const { data: products } = useFetch<Product[]>("/api/products");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function save(s: Partial<Supplier>) {
    setBusy(true);
    try {
      if (s.code && list.some((x) => x.code === s.code) && editing?.code) {
        await api(`/api/suppliers/${encodeURIComponent(s.code)}`, { method: "PATCH", body: JSON.stringify(s) });
      } else {
        await api("/api/suppliers", { method: "POST", body: JSON.stringify(s) });
      }
      setEditing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Supplier) {
    if (
      !(await confirmDialog({
        title: "Delete supplier",
        message: `Delete supplier "${s.name}"?`,
        confirmText: "Delete",
      }))
    )
      return;
    try {
      await api(`/api/suppliers/${encodeURIComponent(s.code)}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Every supplier and what you can order from them"
        actions={
          <button className="btn-primary" onClick={() => setEditing({ ...EMPTY_SUPPLIER })}>
            <Plus size={18} /> Add Supplier
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

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
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/purchase-orders?supplier=${encodeURIComponent(s.code)}`}
                        title="New PO for this supplier"
                        className="grid h-8 w-8 place-items-center rounded-lg text-brand-600 hover:bg-brand-50"
                      >
                        <ShoppingCart size={16} />
                      </Link>
                      <button
                        title="Edit"
                        onClick={() => setEditing(s)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => remove(s)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {editing && (
        <SupplierModal
          initial={editing}
          isNew={!list.some((s) => s.code === editing.code)}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
