"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt as ReceiptIcon, Save, Upload, Image as ImageIcon, Trash2 } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";
import { ReceiptCard, type ReceiptBusiness } from "@/components/Receipt";
import type { ReceiptAccent, Sale } from "@/lib/types";

const ACCENTS: { key: ReceiptAccent; label: string; dot: string }[] = [
  { key: "ink", label: "Black", dot: "bg-ink-900" },
  { key: "brand", label: "Blue", dot: "bg-brand-600" },
  { key: "emerald", label: "Green", dot: "bg-emerald-600" },
  { key: "violet", label: "Purple", dot: "bg-violet-600" },
  { key: "amber", label: "Amber", dot: "bg-amber-500" },
  { key: "rose", label: "Rose", dot: "bg-rose-600" },
];

// What the document is called, when the owner hasn't said otherwise.
const DEFAULT_INVOICE_TITLE = "វិក្កយបត្រ / COMMERCIAL INVOICE";

// A fake sale so the owner sees a realistic receipt while they design it.
const SAMPLE_SALE: Sale = {
  id: "preview",
  invoiceNo: "INV-100123",
  items: [
    { productId: "a", sku: "", name: "ON-Beef Noodle", qty: 2, price: 2.7, cost: 0 } as any,
    { productId: "b", sku: "", name: "Chocolate Cinnamon Roll", qty: 1, price: 0.65, cost: 0 } as any,
    { productId: "c", sku: "", name: "Iced Coffee", qty: 1, price: 1.5, cost: 0 } as any,
  ],
  subtotal: 6.86,
  discount: 0.5,
  tax: 0.69,
  total: 7.05,
  cost: 0,
  profit: 0,
  promotions: [{ code: "P1", name: "Lunch combo", detail: "Noodle + drink", discount: 0.5, freeQty: 0 }],
  paymentMethod: "Cash",
  tendered: 10,
  change: 2.95,
  cashUsd: 7.05,
  cashRiel: 0,
  // A fixed, plausible date — NOT new Date(), which would differ between the
  // server render and the browser, and not epoch 0, which prints "01 Jan 1970"
  // and reads as a bug to the owner designing their slip.
  createdAt: "2026-08-01T08:25:00",
  queueNumber: 7,
} as Sale;

// The same sale, cancelled. A void slip is a document the shop hands to a
// customer and keeps for the books, so the owner needs to be able to look at it
// without voiding a real invoice to find out what it says.
const SAMPLE_VOID: Sale = {
  ...SAMPLE_SALE,
  cancelled: true,
  cancelledAt: "2026-08-01T09:14:00",
  cancelledBy: "Area Manager (Chanvibol)",
  cancelReason: "Customer changed their mind",
} as Sale;

export default function InvoiceSettingsPage() {
  const { data, loading, error, reload } = useFetch<ReceiptBusiness & { name?: string }>("/api/business");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [nameKhmer, setNameKhmer] = useState("");
  const [vatTin, setVatTin] = useState("");
  // Held as ONE textarea string; split into lines only when saving/previewing.
  const [addressKhmer, setAddressKhmer] = useState("");
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [headerNote, setHeaderNote] = useState("");
  const [footerNote, setFooterNote] = useState("");
  const [accent, setAccent] = useState<ReceiptAccent>("ink");
  const [logo, setLogo] = useState<string>(""); // data-URL; "" = no logo
  const [showLogo, setShowLogo] = useState(false);
  const [showVat, setShowVat] = useState(true);
  const [showPickup, setShowPickup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [previewVoid, setPreviewVoid] = useState(false);

  useEffect(() => {
    if (!data || seeded) return;
    setName(data.name || "");
    setAddress(data.address || "");
    setPhone(data.phone || "");
    setNameKhmer(data.nameKhmer || "");
    setVatTin(data.vatTin || "");
    setAddressKhmer((data.addressKhmer || []).join("\n"));
    const r = data.receipt || {};
    setInvoiceTitle(r.invoiceTitle ?? DEFAULT_INVOICE_TITLE);
    setHeaderNote(r.headerNote || "");
    setFooterNote(r.footerNote || "");
    setAccent(r.accent || "ink");
    setLogo(data.logo || "");
    setShowLogo(!!r.showLogo);
    setShowVat(!!r.showVat); // default OFF — total just notes "Includes VAT x%"
    setShowPickup(r.showPickup !== false);
    setSeeded(true);
  }, [data, seeded]);

  // The business object the preview renders from — the DRAFT, so it updates live.
  const khmerLines = useMemo(
    () => addressKhmer.split("\n").map((l) => l.trim()).filter(Boolean),
    [addressKhmer],
  );

  const preview: ReceiptBusiness = useMemo(
    () => ({
      name,
      address,
      phone,
      logo,
      nameKhmer,
      vatTin,
      addressKhmer: khmerLines,
      storeName: (data as any)?.storeName,
      vatRate: data?.vatRate,
      exchangeRate: (data as any)?.exchangeRate,
      receipt: { invoiceTitle, headerNote, footerNote, accent, showLogo, showVat, showPickup },
    }),
    [
      name,
      address,
      phone,
      logo,
      nameKhmer,
      vatTin,
      khmerLines,
      data,
      invoiceTitle,
      headerNote,
      footerNote,
      accent,
      showLogo,
      showVat,
      showPickup,
    ],
  );

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await api("/api/business", {
        method: "PATCH",
        body: JSON.stringify({
          name,
          address,
          phone,
          logo, // "" clears it
          nameKhmer,
          vatTin,
          addressKhmer: khmerLines,
          receipt: { invoiceTitle, headerNote, footerNote, accent, showLogo, showVat, showPickup },
        }),
      });
      setSaved(true);
      reload();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading…" />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <PageHeader
        title="Invoice Customization"
        subtitle="Design the customer receipt — your store name, notes, colour and what to show. The preview updates as you type."
        actions={
          <button className="btn-primary" disabled={busy} onClick={save}>
            <Save size={16} /> {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Editor */}
        <div className="space-y-5">
          <Card title="Header" subtitle="What prints at the top of every receipt" icon={<ReceiptIcon size={15} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Store name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ON Mart" />
              </Field>
              <Field label="Phone">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="023 900 100" />
              </Field>
              <Field label="Address" full>
                <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="St. 271, Phnom Penh" />
              </Field>
              {/* The Khmer identity. A Cambodian commercial invoice is read in
                  Khmer and carries the VAT registration number — and it is
                  edited HERE, next to the live preview, rather than buried in
                  Store Settings where you would be typing Khmer blind. */}
              <Field label="Store name in Khmer" full>
                <input
                  className="input"
                  value={nameKhmer}
                  onChange={(e) => setNameKhmer(e.target.value)}
                  placeholder="អង្គរ ប្រូតូតាយ"
                />
              </Field>
              <Field label="VAT registration number (VATTIN)" full>
                <input
                  className="input"
                  value={vatTin}
                  onChange={(e) => setVatTin(e.target.value)}
                  placeholder="L001-901503056"
                />
              </Field>
              <Field label="Address in Khmer (one line each)" full>
                <textarea
                  className="input min-h-[64px]"
                  value={addressKhmer}
                  onChange={(e) => setAddressKhmer(e.target.value)}
                  placeholder={"ផ្ទះលេខ០១ ផ្លូវ៥៩២ កែងផ្លូវ១០៦\nបឹងកក់ទី២ ទួលគោក រាជធានីភ្នំពេញ"}
                />
              </Field>
              <Field label="Welcome line (optional)" full>
                <input className="input" value={headerNote} onChange={(e) => setHeaderNote(e.target.value)} placeholder="Welcome to ON Mart!" maxLength={120} />
              </Field>
              <Field label="Document title" full>
                <input
                  className="input"
                  value={invoiceTitle}
                  onChange={(e) => setInvoiceTitle(e.target.value)}
                  placeholder="វិក្កយបត្រ / COMMERCIAL INVOICE"
                  maxLength={80}
                />
              </Field>
            </div>
          </Card>

          <Card title="Footer" subtitle="A thank-you line at the very bottom">
            <input className="input" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} placeholder="Thank you — see you again!" maxLength={120} />
          </Card>

          <Card title="Style & content">
            <div>
              <p className="label">Accent colour (store name &amp; total)</p>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => setAccent(a.key)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                      accent === a.key ? "border-brand-400 bg-brand-50 text-ink-900 ring-2 ring-brand-100" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className={`h-3 w-3 rounded-full ${a.dot}`} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <p className="label">Store logo</p>
              <LogoUpload
                value={logo}
                onChange={(v) => {
                  setLogo(v);
                  if (v) setShowLogo(true); // uploading a logo turns it on
                }}
              />
            </div>

            <div className="mt-4 space-y-2">
              {logo && <Toggle label="Show store logo on the receipt" on={showLogo} onToggle={() => setShowLogo((v) => !v)} />}
              <Toggle label="Break out VAT (subtotal + VAT lines) — off shows only ‘Includes VAT’" on={showVat} onToggle={() => setShowVat((v) => !v)} />
              <Toggle label="Show pickup number when there is one" on={showPickup} onToggle={() => setShowPickup((v) => !v)} />
            </div>
          </Card>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Live preview</p>
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              {[
                { on: false, label: "Sale" },
                { on: true, label: "Cancelled" },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => setPreviewVoid(t.on)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                    previewVoid === t.on ? "bg-white text-ink-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-100 p-5">
            <div className="mx-auto w-full max-w-sm rounded-xl bg-white p-4 shadow-soft">
              <ReceiptCard sale={previewVoid ? SAMPLE_VOID : SAMPLE_SALE} business={preview} />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">Sample data — real sales show their own items and totals.</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// Upload a logo for the receipt. Downscales the image client-side (max 400px,
// keeps PNG transparency) and hands back a small data-URL.
function LogoUpload({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  function pick(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
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
        <p className="text-[11px] text-slate-400">PNG, JPG, SVG or WebP. Shown at the top of the receipt.</p>
      </div>
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-left ring-1 ring-slate-200 hover:ring-slate-300">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${on ? "bg-brand-600" : "bg-slate-300"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
