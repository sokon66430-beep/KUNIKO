"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Save, Upload, Image as ImageIcon, Trash2, Check, QrCode, ShoppingBag } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";
import type { CustomerDisplaySettings, CustomerDisplayTheme } from "@/lib/types";

// Colour swatches the owner picks the screen's highlight from. Each is a hex the
// customer screen reads straight into its --cd-accent variable.
const ACCENTS = [
  { hex: "#6ea0ff", label: "Sky" },
  { hex: "#2549e8", label: "Brand blue" },
  { hex: "#12b76a", label: "Green" },
  { hex: "#7c5cff", label: "Violet" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#f43f5e", label: "Rose" },
];

type BusinessCfg = { name?: string; logo?: string; customerDisplay?: CustomerDisplaySettings };
type PreviewState = "idle" | "sale" | "thanks";

export default function CustomerScreenSettingsPage() {
  const { data, loading, error, reload } = useFetch<BusinessCfg>("/api/business");

  const [theme, setTheme] = useState<CustomerDisplayTheme>("dark");
  const [brandName, setBrandName] = useState("");
  const [accent, setAccent] = useState("#6ea0ff");
  const [welcomeLine, setWelcomeLine] = useState("");
  const [idleSub, setIdleSub] = useState("");
  const [thanksTitle, setThanksTitle] = useState("");
  const [thanksSub, setThanksSub] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [showRiel, setShowRiel] = useState(true);
  const [ads, setAds] = useState<string[]>([]);
  const [adSeconds, setAdSeconds] = useState(6);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");

  useEffect(() => {
    if (!data || seeded) return;
    const c = data.customerDisplay || {};
    setTheme(c.theme === "dark" ? "dark" : "light");
    setBrandName(c.brandName ?? "ON MART");
    setAccent(c.accent || "#6ea0ff");
    setWelcomeLine(c.welcomeLine ?? "Welcome · សូមស្វាគមន៍");
    setIdleSub(c.idleSub ?? "Please hand your items to our cashier");
    setThanksTitle(c.thanksTitle ?? "Thank you");
    setThanksSub(c.thanksSub ?? "អរគុណ");
    setShowLogo(c.showLogo !== false);
    setShowRiel(c.showRiel !== false);
    setAds(Array.isArray(c.ads) ? c.ads : []);
    setAdSeconds(c.adSeconds || 6);
    setSeeded(true);
  }, [data, seeded]);

  const cfg = useMemo(
    () => ({ theme, brandName, accent, welcomeLine, idleSub, thanksTitle, thanksSub, showLogo, showRiel, ads, adSeconds }),
    [theme, brandName, accent, welcomeLine, idleSub, thanksTitle, thanksSub, showLogo, showRiel, ads, adSeconds],
  );

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await api("/api/business", { method: "PATCH", body: JSON.stringify({ customerDisplay: cfg }) });
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
        title="Customer Screen"
        subtitle="Design the second screen your customers watch on the till — colours, greetings, logo and promotional pictures. The preview updates as you type."
        actions={
          <button className="btn-primary" disabled={busy} onClick={save}>
            <Save size={16} /> {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(360px,460px)]">
        {/* Editor */}
        <div className="space-y-5">
          <Card title="Look" subtitle="The overall colour of the screen" icon={<Monitor size={15} />}>
            <div>
              <p className="label">Background</p>
              <div className="flex gap-2">
                {(["dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold capitalize transition ${
                      theme === t ? "border-brand-400 bg-brand-50 text-ink-900 ring-2 ring-brand-100" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className="mr-2 inline-block h-3 w-3 translate-y-px rounded-full"
                      style={{ background: t === "dark" ? "#0e1526" : "#f5f7fb", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)" }}
                    />
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <p className="label">Highlight colour (totals &amp; accents)</p>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.hex}
                    onClick={() => setAccent(a.hex)}
                    title={a.label}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                      accent === a.hex ? "border-brand-400 bg-brand-50 text-ink-900 ring-2 ring-brand-100" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: a.hex }} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Greeting" subtitle="Shown on the idle screen between customers">
            <div className="grid gap-3">
              <Field label="Brand name (what customers see — e.g. ON MART)">
                <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="ON MART" maxLength={40} />
              </Field>
              <Field label="Welcome line">
                <input className="input" value={welcomeLine} onChange={(e) => setWelcomeLine(e.target.value)} placeholder="Welcome · សូមស្វាគមន៍" maxLength={80} />
              </Field>
              <Field label="Small line under it">
                <input className="input" value={idleSub} onChange={(e) => setIdleSub(e.target.value)} placeholder="Please hand your items to our cashier" maxLength={120} />
              </Field>
            </div>
            <div className="mt-3">
              <Toggle label="Show store logo on the idle screen" on={showLogo} onToggle={() => setShowLogo((v) => !v)} />
            </div>
          </Card>

          <Card title="Thank-you screen" subtitle="Shown after payment is complete">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Heading">
                <input className="input" value={thanksTitle} onChange={(e) => setThanksTitle(e.target.value)} placeholder="Thank you" maxLength={60} />
              </Field>
              <Field label="Second line">
                <input className="input" value={thanksSub} onChange={(e) => setThanksSub(e.target.value)} placeholder="អរគុណ" maxLength={60} />
              </Field>
            </div>
            <div className="mt-3">
              <Toggle label="Show riel (៛) amounts beside dollars" on={showRiel} onToggle={() => setShowRiel((v) => !v)} />
            </div>
          </Card>

          <Card
            title="Promotional pictures"
            subtitle="Shown as a slideshow on the idle screen. Add your promo posters — up to 6."
            icon={<ImageIcon size={15} />}
          >
            <AdManager ads={ads} onChange={setAds} />
            {ads.length > 1 && (
              <div className="mt-4 flex items-center gap-3">
                <span className="label mb-0">Seconds per picture</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={adSeconds}
                  onChange={(e) => setAdSeconds(Math.min(30, Math.max(3, Number(e.target.value) || 6)))}
                  className="input w-24"
                />
              </div>
            )}
            <p className="mt-3 text-[12px] text-slate-400">
              Videos aren&apos;t supported yet — they&apos;re coming in a later update. For now, pictures rotate here.
            </p>
          </Card>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Live preview</p>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
              {(["idle", "sale", "thanks"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPreviewState(s)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition ${
                    previewState === s ? "bg-white text-ink-900 shadow-soft" : "text-slate-500 hover:text-ink-800"
                  }`}
                >
                  {s === "sale" ? "Selling" : s === "thanks" ? "Paid" : "Idle"}
                </button>
              ))}
            </div>
          </div>
          <Preview cfg={cfg} storeName={data?.name || "ON Mart"} logo={data?.logo} state={previewState} />
          <p className="mt-2 text-xs text-slate-400">A scaled preview — the real second screen fills the whole T3 display.</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// Soft rgba from a #rrggbb, for the preview's pastel accent tints.
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return `rgba(110,160,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// A small, faithful mock of the customer screen at the current draft settings —
// same warm, rounded look the real second screen uses.
function Preview({
  cfg,
  storeName,
  logo,
  state,
}: {
  cfg: CustomerDisplaySettings;
  storeName: string;
  logo?: string;
  state: PreviewState;
}) {
  const light = cfg.theme === "light";
  const accent = cfg.accent || "#6ea0ff";
  const bg = light ? "#f5f7fc" : "#0f1729";
  const fg = light ? "#141b2e" : "#f4f6fb";
  const muted = light ? "#6b7896" : "#9db0d0";
  const card = light ? "#ffffff" : "rgba(255,255,255,0.055)";
  const soft = rgba(accent, light ? 0.12 : 0.18);
  const soft2 = rgba(accent, light ? 0.08 : 0.12);
  const shadow = light ? "0 4px 12px rgba(24,36,70,0.10)" : "0 4px 14px rgba(0,0,0,0.34)";
  const ads = cfg.ads || [];
  const name = cfg.brandName || storeName;

  const badge = (size: number) => (
    <span className="grid place-items-center" style={{ width: size, height: size, borderRadius: size * 0.32, background: soft, color: accent, overflow: "hidden" }}>
      {logo && cfg.showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 2 }} />
      ) : (
        <ShoppingBag size={size * 0.5} />
      )}
    </span>
  );

  // Match the real customer screen: Jakarta for Latin, Kantumruy Pro for Khmer.
  const font = "'Plus Jakarta Sans Variable','Kantumruy Pro','Battambang','Noto Sans Khmer','Khmer UI','Segoe UI',sans-serif";

  return (
    <div className="overflow-hidden rounded-2xl shadow-soft ring-1 ring-slate-200" style={{ aspectRatio: "16 / 9", background: bg, color: fg, fontFamily: font }}>
      <div className="flex h-full flex-col text-center" style={{ fontSize: "10px" }}>
        {/* top bar */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="flex items-center gap-1.5 font-extrabold" style={{ fontSize: "13px" }}>
            {badge(20)}
            {name}
          </span>
          {state === "sale" && (
            <span style={{ color: accent, fontSize: "9px", fontWeight: 700, background: soft, padding: "2px 8px", borderRadius: 999 }}>3 items</span>
          )}
        </div>

        {state === "idle" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-3" style={{ minHeight: 0 }}>
            {ads.length > 0 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ads[0]} alt="" style={{ maxHeight: "58%", maxWidth: "90%", objectFit: "contain", borderRadius: 12, boxShadow: shadow }} />
                <div style={{ fontSize: "15px", fontWeight: 800 }}>{name}</div>
                {cfg.welcomeLine && <div style={{ color: accent, fontWeight: 800 }}>{cfg.welcomeLine}</div>}
              </>
            ) : (
              <>
                <span className="grid place-items-center" style={{ width: 46, height: 46, borderRadius: 16, background: soft, color: accent, boxShadow: shadow, overflow: "hidden" }}>
                  {logo && cfg.showLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} />
                  ) : (
                    <ShoppingBag size={24} />
                  )}
                </span>
                <div style={{ fontSize: "20px", fontWeight: 800 }}>{name}</div>
                {cfg.welcomeLine && <div style={{ color: accent, fontWeight: 800, fontSize: "13px" }}>{cfg.welcomeLine}</div>}
                {cfg.idleSub && (
                  <div style={{ color: muted, background: card, boxShadow: shadow, padding: "4px 12px", borderRadius: 999 }}>{cfg.idleSub}</div>
                )}
              </>
            )}
          </div>
        )}

        {state === "sale" && (
          <div className="grid flex-1 gap-1.5 p-2" style={{ gridTemplateColumns: "1fr 40%", minHeight: 0 }}>
            <div className="flex flex-col gap-1.5 p-1 text-left" style={{ overflow: "hidden" }}>
              {[["2×", "ON-Beef Noodle", "$5.40"], ["1×", "Iced Coffee", "$1.50"], ["1×", "Chinese Bun", "$0.80"]].map((l, i) => (
                <div key={i} className="flex items-center gap-1.5" style={{ background: card, boxShadow: shadow, borderRadius: 10, padding: "6px 9px" }}>
                  <span style={{ color: accent, fontWeight: 800, background: soft, borderRadius: 5, padding: "0 5px" }}>{l[0]}</span>
                  <span className="flex-1 truncate" style={{ fontWeight: 700 }}>{l[1]}</span>
                  <span style={{ fontWeight: 800 }}>{l[2]}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center justify-center gap-0.5 p-2 text-center" style={{ background: soft2, border: `1px solid ${soft}`, borderRadius: 16, boxShadow: shadow }}>
              <div style={{ color: muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 800, fontSize: "8px" }}>Total to pay</div>
              <div style={{ fontSize: "30px", fontWeight: 800, lineHeight: 1 }}>$7.70</div>
              {cfg.showRiel !== false && (
                <div style={{ color: accent, fontWeight: 800, fontSize: "12px", background: soft, padding: "1px 8px", borderRadius: 999 }}>៛31,570</div>
              )}
              <div style={{ color: muted, fontSize: "8px", marginTop: 2 }}>VAT 10% included</div>
            </div>
          </div>
        )}

        {state === "thanks" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-3">
            <div className="grid place-items-center" style={{ width: 48, height: 48, borderRadius: 999, background: "#12b76a", color: "#fff", boxShadow: "0 0 0 6px rgba(18,183,106,0.18)" }}>
              <Check size={26} strokeWidth={3} />
            </div>
            <div style={{ fontSize: "20px", fontWeight: 800 }}>{cfg.thanksTitle || "Thank you"}</div>
            {cfg.thanksSub && <div style={{ color: accent, fontWeight: 800, fontSize: "13px" }}>{cfg.thanksSub}</div>}
            <div style={{ color: muted, background: card, boxShadow: shadow, padding: "4px 12px", borderRadius: 999 }}>Paid $7.70 · Cash</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Upload / reorder / remove promo pictures. Each image is downscaled client-side
// to keep the store's data small, then held as a data-URL.
function AdManager({ ads, onChange }: { ads: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  function addFiles(files: FileList) {
    setWorking(true);
    const slots = Math.max(0, 6 - ads.length);
    const chosen = Array.from(files).slice(0, slots);
    let done = 0;
    const collected: string[] = [];
    if (chosen.length === 0) {
      setWorking(false);
      return;
    }
    chosen.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        const finish = (val: string) => {
          collected.push(val);
          done += 1;
          if (done === chosen.length) {
            onChange([...ads, ...collected]);
            setWorking(false);
          }
        };
        if (file.type === "image/svg+xml") return finish(src);
        const img = new Image();
        img.onload = () => {
          const MAX = 1280;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
          finish(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => finish(src);
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ads.length) return;
    const next = [...ads];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ads.map((a, i) => (
          <div key={i} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a} alt={`Promo ${i + 1}`} className="aspect-video w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-1.5 py-1 opacity-0 transition group-hover:opacity-100">
              <div className="flex gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded bg-white/90 px-1.5 text-xs font-bold text-ink-900 disabled:opacity-40">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === ads.length - 1} className="rounded bg-white/90 px-1.5 text-xs font-bold text-ink-900 disabled:opacity-40">↓</button>
              </div>
              <button onClick={() => onChange(ads.filter((_, k) => k !== i))} className="rounded bg-rose-500 px-1.5 text-xs font-bold text-white">
                <Trash2 size={12} />
              </button>
            </div>
            <span className="absolute left-1 top-1 rounded bg-black/50 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
          </div>
        ))}
        {ads.length < 6 && (
          <button
            onClick={() => ref.current?.click()}
            disabled={working}
            className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 transition hover:border-brand-300 hover:text-brand-500"
          >
            <Upload size={18} />
            <span className="text-xs font-semibold">{working ? "Adding…" : "Add picture"}</span>
          </button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          if (ref.current) ref.current.value = "";
        }}
      />
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
