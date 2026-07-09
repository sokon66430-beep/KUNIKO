"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus, Users, Crown, Star, Pencil, Trash2, Phone, Mail } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Customer } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal } from "@/components/ui";
import { usd, num, shortDate } from "@/lib/format";

export default function CustomersPage() {
  const { data: customers, loading, error, reload } = useFetch<Customer[]>("/api/customers");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    let list = customers || [];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [customers, query]);

  const totalSpent = (customers || []).reduce((s, c) => s + c.totalSpent, 0);
  const gold = (customers || []).filter((c) => c.tier === "Gold").length;
  const points = (customers || []).reduce((s, c) => s + c.loyaltyPoints, 0);

  async function save(c: Partial<Customer>) {
    setBusy(true);
    try {
      if (c.id) {
        await api(`/api/customers/${c.id}`, { method: "PATCH", body: JSON.stringify(c) });
      } else {
        await api("/api/customers", { method: "POST", body: JSON.stringify(c) });
      }
      setEditing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Customer) {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    await api(`/api/customers/${c.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Loyalty, spend history and tiers"
        actions={
          <button className="btn-primary" onClick={() => setEditing({ name: "", phone: "", email: "" })}>
            <UserPlus size={18} /> Add Customer
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Customers" value={num(customers?.length || 0)} icon={<Users size={18} />} accent="brand" />
        <StatCard label="Gold Members" value={num(gold)} icon={<Crown size={18} />} accent="amber" />
        <StatCard label="Lifetime Spend" value={usd(totalSpent)} icon={<Star size={18} />} accent="emerald" />
        <StatCard label="Loyalty Points" value={num(points)} icon={<Star size={18} />} accent="violet" />
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder="Search by name, phone or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading customers…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 text-center font-semibold">Tier</th>
                  <th className="px-4 py-3 text-right font-semibold">Visits</th>
                  <th className="px-4 py-3 text-right font-semibold">Points</th>
                  <th className="px-4 py-3 text-right font-semibold">Total Spent</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                          {c.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-ink-800">{c.name}</p>
                          {c.lastVisit && <p className="text-xs text-slate-400">last visit {shortDate(c.lastVisit)}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" /> {c.phone || "—"}</p>
                      {c.email && <p className="flex items-center gap-1.5 text-xs text-slate-400"><Mail size={12} /> {c.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <TierBadge tier={c.tier} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{c.visits}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-600">{num(c.loyaltyPoints)}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink-900">{usd(c.totalSpent)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(c)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <CustomerModal initial={editing} busy={busy} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function TierBadge({ tier }: { tier: Customer["tier"] }) {
  if (tier === "Gold") return <Badge tone="gold">★ Gold</Badge>;
  if (tier === "Silver") return <Badge tone="slate">Silver</Badge>;
  return <Badge tone="brand">Bronze</Badge>;
}

function CustomerModal({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Customer>;
  busy: boolean;
  onClose: () => void;
  onSave: (c: Partial<Customer>) => void;
}) {
  const [form, setForm] = useState<Partial<Customer>>(initial);
  const set = (k: keyof Customer, v: any) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? "Edit Customer" : "Add Customer"}
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
      <div className="space-y-3">
        <div>
          <label className="label">Full name</label>
          <input className="input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input className="input" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
