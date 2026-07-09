"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Save, Building2, PartyPopper } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { DB } from "@/lib/types";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";

type Business = DB["meta"]["business"];

export default function SettingsPage() {
  const params = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const { data, loading, error, reload } = useFetch<Business>("/api/business");
  const [form, setForm] = useState<Business | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (k: keyof Business, v: any) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setApprover = (idx: number, k: "role" | "name" | "code", v: string) =>
    setForm((f) =>
      f ? { ...f, approvers: (f.approvers || []).map((a, i) => (i === idx ? { ...a, [k]: v } : a)) } : f,
    );

  async function save() {
    if (!form) return;
    setBusy(true);
    setSaved(false);
    try {
      await api("/api/business", {
        method: "PATCH",
        body: JSON.stringify({
          branch: form.branch,
          address: form.address,
          phone: form.phone,
          shipTo: form.shipTo,
          receivedBy: form.receivedBy,
          authorizedBy: form.authorizedBy,
          vatRate: form.vatRate,
          invoiceTo: form.invoiceTo,
          poNotes: form.poNotes,
          approvers: form.approvers,
        }),
      });
      setSaved(true);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Store Settings"
        subtitle="This store's details — used on purchase orders, prints and exports"
        actions={
          <button className="btn-primary" disabled={busy || !form} onClick={save}>
            <Save size={18} /> {busy ? "Saving…" : "Save Changes"}
          </button>
        }
      />

      {welcome && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <PartyPopper size={18} className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <p className="font-semibold">Welcome — your store is ready!</p>
            <p className="mt-0.5 text-brand-700">
              Finish setting up your store profile below (address, phone and PO details). These
              appear on your purchase orders. Click <span className="font-semibold">Save Changes</span> when done.
            </p>
          </div>
        </div>
      )}

      {error && <ErrorBox message={error} />}
      {saved && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Store settings saved.
        </div>
      )}

      {loading || !form ? (
        <Card>
          <Spinner label="Loading settings…" />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900">
              <Building2 size={16} className="text-brand-600" /> Store Identity
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">Store / Branch name</label>
                <input className="input" value={form.branch} onChange={(e) => set("branch", e.target.value)} />
              </div>
              <div>
                <label className="label">Address</label>
                <input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div>
                <label className="label">VAT rate (%)</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  value={Math.round((form.vatRate || 0) * 100)}
                  onChange={(e) => set("vatRate", (Number(e.target.value) || 0) / 100)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-4 text-sm font-bold text-ink-900">Purchase Order Header</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Ship to (delivery address)</label>
                <input className="input" value={form.shipTo} onChange={(e) => set("shipTo", e.target.value)} />
              </div>
              <div>
                <label className="label">Received by (contacts)</label>
                <input className="input" value={form.receivedBy} onChange={(e) => set("receivedBy", e.target.value)} />
              </div>
              <div>
                <label className="label">Authorized by</label>
                <input className="input" value={form.authorizedBy} onChange={(e) => set("authorizedBy", e.target.value)} />
              </div>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="mb-1 text-sm font-bold text-ink-900">Receipt-edit approvers</h3>
            <p className="mb-4 text-xs text-slate-500">
              Staff can edit a submitted goods receipt, but the change only affects stock after one of these people
              approves it — by scanning their badge or typing their code on the receipt.
            </p>
            <div className="space-y-3">
              {(form.approvers || []).map((a, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label">Role</label>
                    <input className="input" value={a.role} onChange={(e) => setApprover(i, "role", e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Name (optional)</label>
                    <input className="input" value={a.name || ""} onChange={(e) => setApprover(i, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Approval code / badge</label>
                    <input
                      className="input tracking-widest"
                      value={a.code}
                      onChange={(e) => setApprover(i, "code", e.target.value)}
                      placeholder="e.g. 1234"
                    />
                  </div>
                </div>
              ))}
              {(form.approvers || []).length === 0 && (
                <p className="text-sm text-slate-400">No approvers set.</p>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="mb-4 text-sm font-bold text-ink-900">Invoice-to & Notes (printed on every PO)</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Invoice-to lines (one per line)</label>
                <textarea
                  className="input min-h-[110px] font-normal"
                  value={(form.invoiceTo || []).join("\n")}
                  onChange={(e) => set("invoiceTo", e.target.value.split("\n"))}
                />
              </div>
              <div>
                <label className="label">Standing PO notes (one per line)</label>
                <textarea
                  className="input min-h-[110px] font-normal"
                  value={(form.poNotes || []).join("\n")}
                  onChange={(e) => set("poNotes", e.target.value.split("\n"))}
                />
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
