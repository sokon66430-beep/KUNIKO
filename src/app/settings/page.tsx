"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Save, Building2, PartyPopper, KeyRound, Sun, Moon, Upload, Trash2, ImageIcon } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { DB } from "@/lib/types";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";
import { useTheme } from "@/components/theme";

type Business = DB["meta"]["business"];

export default function SettingsPage() {
  const params = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const { data, loading, error, reload } = useFetch<Business>("/api/business");
  const [form, setForm] = useState<Business | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Only seed the form from the server ONCE (the first successful load). useFetch
  // silently re-polls in the background (every 20s, and whenever the tab regains
  // focus/visibility) so it stays current on other screens — but here that refetch
  // was stomping on in-progress edits. That's most visible with the logo picker:
  // opening the phone's photo app backgrounds the tab, and returning re-focuses
  // it, triggering a refetch that wiped out the just-picked logo before Save.
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

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
          logo: form.logo ?? "",
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

      <AppearanceCard />

      <ChangePasswordCard />

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
                <label className="label">Logo (printed on purchase orders)</label>
                <LogoUpload value={form.logo} onChange={(v) => set("logo", v as any)} />
              </div>
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

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { key: "light" | "dark"; label: string; icon: any; hint: string }[] = [
    { key: "light", label: "Light", icon: Sun, hint: "Bright, white background" },
    { key: "dark", label: "Dark", icon: Moon, hint: "Dark, easy on the eyes" },
  ];
  return (
    <Card className="mb-6">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink-900">
        {theme === "dark" ? <Moon size={16} className="text-brand-600" /> : <Sun size={16} className="text-brand-600" />}{" "}
        Appearance
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        Switch the whole app between light and dark. Your choice is saved on this device.
      </p>
      <div className="grid max-w-md gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const active = theme === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setTheme(o.key)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                active
                  ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                  active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                <o.icon size={17} />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-bold ${active ? "text-brand-700" : "text-ink-900"}`}>
                  {o.label}
                </span>
                <span className="block text-[11px] text-slate-500">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ChangePasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (next !== confirm) {
      setMsg({ ok: false, text: "New passwords don't match" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      setMsg({ ok: true, text: "Password changed. Use it next time you sign in." });
      setCur("");
      setNext("");
      setConfirm("");
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink-900">
        <KeyRound size={16} className="text-brand-600" /> Change your password
      </h3>
      <p className="mb-4 text-xs text-slate-500">Change the password for the account you're signed in with.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Current password</label>
          <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div>
          <label className="label">New password</label>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary" disabled={busy || !cur || !next} onClick={submit}>
          <KeyRound size={16} /> {busy ? "Changing…" : "Update password"}
        </button>
        {msg && (
          <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>
        )}
      </div>
    </Card>
  );
}

// Logo upload for the PO header. Shrinks the image client-side (max 400px,
// keeps transparency for PNGs) and stores it as a data URL on the business.
function LogoUpload({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  function pick(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      // SVGs stay as-is; raster images are downscaled to keep the file small.
      if (file.type === "image/svg+xml") {
        onChange(src);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        // PNG preserves transparency; large photos still stay small at this size.
        onChange(c.toDataURL("image/png"));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-3">
      <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Logo" className="max-h-14 max-w-[104px] object-contain" />
        ) : (
          <ImageIcon size={20} className="text-slate-300" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => ref.current?.click()}>
          <Upload size={14} /> {value ? "Replace logo" : "Upload logo"}
        </button>
        {value && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:underline"
            onClick={() => onChange("")}
          >
            <Trash2 size={13} /> Remove
          </button>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            if (ref.current) ref.current.value = "";
          }}
        />
      </div>
    </div>
  );
}
