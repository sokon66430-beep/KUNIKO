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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Store</th>
                  <th className="px-4 py-3 text-center font-semibold">Employees</th>
                  <th className="px-4 py-3 text-center font-semibold">Products</th>
                  <th className="px-4 py-3 text-center font-semibold">Open POs</th>
                  <th className="px-4 py-3 text-center font-semibold">Low stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Stock value</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.stores || []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-800">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.id}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{num(s.staff)}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{num(s.products)}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{num(s.openPOs)}</td>
                    <td className={`px-4 py-3 text-center font-medium ${s.lowStock > 0 ? "text-rose-500" : "text-slate-400"}`}>
                      {num(s.lowStock)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-800">{usd(s.invValue)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openStore(s.id)}
                        disabled={opening === s.id}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                      >
                        {opening === s.id ? "Opening…" : "Open"} <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
