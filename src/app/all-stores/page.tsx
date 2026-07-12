"use client";

import { useRef, useState } from "react";
import { Building2, Package, Users, Truck, DollarSign, ArrowRight, Download, Upload, ShieldAlert } from "lucide-react";
import { useFetch } from "@/lib/client";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { num, usd } from "@/lib/format";

type StoreRow = {
  id: string;
  name: string;
  products: number;
  staff: number;
  openPOs: number;
  lowStock: number;
  salesTotal: number;
  invValue: number;
  retailValue: number;
};
type AllStores = {
  stores: StoreRow[];
  totals: { stores: number; products: number; staff: number; openPOs: number; salesTotal: number; invValue: number };
};

export default function AllStoresPage() {
  const { data, loading, error } = useFetch<AllStores>("/api/all-stores");
  const [opening, setOpening] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  async function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (restoreRef.current) restoreRef.current.value = "";
    if (!file) return;
    if (
      !(await confirmDialog({
        title: "Restore from backup",
        message:
          "Restore from this backup? It REPLACES all current stores and data with the backup. This cannot be undone.",
        confirmText: "Restore & replace",
      }))
    )
      return;
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/backup/restore", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Restore failed");
      setRestoreMsg({ ok: true, text: `Restored ${d.stores} store(s). Reloading…` });
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: any) {
      setRestoreMsg({ ok: false, text: err.message });
    } finally {
      setRestoring(false);
    }
  }

  async function openStore(id: string) {
    setOpening(id);
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: id }),
    });
    window.location.href = "/"; // full reload into that store
  }

  const t = data?.totals;

  return (
    <div>
      <PageHeader title="All Stores" subtitle="Your whole business at a glance — totals, then store by store" />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Stores" value={num(t?.stores ?? 0)} icon={<Building2 size={18} />} accent="brand" />
        <StatCard label="Employees" value={num(t?.staff ?? 0)} icon={<Users size={18} />} accent="violet" />
        <StatCard label="Products" value={num(t?.products ?? 0)} icon={<Package size={18} />} accent="emerald" />
        <StatCard label="Open POs" value={num(t?.openPOs ?? 0)} icon={<Truck size={18} />} accent="amber" />
      </div>

      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <Building2 size={16} /> Store by store
      </h2>

      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading stores…" />
        ) : (data?.stores || []).length === 0 ? (
          <EmptyState title="No stores yet" hint="Add stores in Stores & Employees." />
        ) : (
          <div>
            {(data?.stores || []).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {s.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">{s.id}</span>
                  </p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {num(s.staff)} employee{s.staff === 1 ? "" : "s"} · {num(s.products)} products · {num(s.openPOs)} open PO
                    {s.openPOs === 1 ? "" : "s"} ·{" "}
                    <span className={s.lowStock > 0 ? "font-medium text-rose-500" : "text-slate-400"}>
                      {num(s.lowStock)} low stock
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-ink-800">{usd(s.invValue)}</span>
                  <button
                    onClick={() => openStore(s.id)}
                    disabled={opening === s.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-100"
                  >
                    {opening === s.id ? "Opening…" : "Open"} <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
        <DollarSign size={13} /> "Open" switches you into that store to see its full data. Use the store name in the
        sidebar to switch back.
      </p>

      {/* Backup & restore — protect all your data */}
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <ShieldAlert size={16} /> Backup
      </h2>
      <Card>
        <p className="mb-4 text-sm text-slate-500">
          Download a full backup of <b>every store</b> (products, orders, stock, counts, employees) as one file. Keep
          it somewhere safe — if anything ever goes wrong, you can restore from it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/backup" className="btn-primary">
            <Download size={18} /> Download backup
          </a>
          <button className="btn-ghost" disabled={restoring} onClick={() => restoreRef.current?.click()}>
            <Upload size={18} /> {restoring ? "Restoring…" : "Restore from backup"}
          </button>
          <input ref={restoreRef} type="file" accept=".json" hidden onChange={onRestoreFile} />
          {restoreMsg && (
            <span className={`text-sm font-medium ${restoreMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>
              {restoreMsg.text}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Tip: download a backup regularly (e.g. weekly). Restoring <b>replaces</b> all current data with the backup.
        </p>
      </Card>
    </div>
  );
}
