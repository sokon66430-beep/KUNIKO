"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus, Users, Crown, Star, Pencil, Trash2, Phone, Mail } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Customer } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
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
    if (
      !(await confirmDialog({
        title: "Delete customer",
        message: `Delete customer "${c.name}"?`,
        confirmText: "Delete",
      }))
    )
      return;
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
          <div>
            {filtered.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                    {c.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">
                      {c.name}
                      {c.lastVisit && (
                        <span className="ml-2 text-xs font-normal text-slate-400">last visit {shortDate(c.lastVisit)}</span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 truncate text-sm text-slate-500">
                      <span className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" /> {c.phone || "—"}</span>
                      {c.email && <span className="flex items-center gap-1.5 text-xs text-slate-400"><Mail size={12} /> {c.email}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-slate-500">
                    {c.visits} visit{c.visits === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-violet-600">{num(c.loyaltyPoints)} pts</span> ·{" "}
                    <span className="font-bold text-ink-900">{usd(c.totalSpent)}</span>
                  </span>
                  <TierBadge tier={c.tier} />
                  <div className="flex items-center gap-1">
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
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-5 py-12 text-center text-slate-400">No customers found.</p>
            )}
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
