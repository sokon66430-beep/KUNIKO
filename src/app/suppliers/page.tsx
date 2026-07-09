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
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { num } from "@/lib/format";

const EMPTY: Partial<Supplier> = {
  code: "",
  name: "",
  address: "",
  city: "",
  country: "",
  contactPerson: "",
  phone: "",
  email: "",
  deliverySchedule: "",
  leadTime: 0,
  minOrderAmount: 0,
  taxId: "",
  taxPct: 10,
};

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
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
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
          <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Supplier</th>
                  <th className="px-4 py-3 text-center font-semibold">Products</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Delivery</th>
                  <th className="px-4 py-3 text-center font-semibold">Lead time</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const count = productCountByCode.get(s.code) || 0;
                  return (
                    <tr key={s.code} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-800">{s.name}</p>
                        <p className="text-xs text-slate-400">{s.code}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {count > 0 ? (
                          <Link href={`/inventory?supplier=${encodeURIComponent(s.code)}`}>
                            <Badge tone="brand">{count} products</Badge>
                          </Link>
                        ) : (
                          <Badge tone="slate">0 products</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {s.contactPerson || "—"}
                        {s.phone && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400">
                            <Phone size={11} /> {s.phone}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.deliverySchedule || "—"}</td>
                      <td className="px-4 py-3 text-center text-slate-600">
                        {s.leadTime ? `${s.leadTime}d` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

function SupplierModal({
  initial,
  isNew,
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Supplier>;
  isNew: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (s: Partial<Supplier>) => void;
}) {
  const [form, setForm] = useState<Partial<Supplier>>(initial);
  const set = (k: keyof Supplier, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add Supplier" : `Edit Supplier — ${initial.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !form.name} onClick={() => onSave(form)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Supplier name</label>
          <input className="input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        {isNew && (
          <div>
            <label className="label">Code</label>
            <input
              className="input"
              placeholder="auto"
              value={form.code || ""}
              onChange={(e) => set("code", e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="label">Contact person</label>
          <input className="input" value={form.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className="label">Delivery day</label>
          <input
            className="input"
            placeholder="e.g. TUE"
            value={form.deliverySchedule || ""}
            onChange={(e) => set("deliverySchedule", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Lead time (days)</label>
          <input className="input" type="number" value={form.leadTime ?? 0} onChange={(e) => set("leadTime", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Address</label>
          <input className="input" value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city || ""} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div>
          <label className="label">Tax ID</label>
          <input className="input" value={form.taxId || ""} onChange={(e) => set("taxId", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
