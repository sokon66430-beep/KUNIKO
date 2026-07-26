"use client";

import { useEffect, useMemo, useState } from "react";
import { Monitor, Volume2, Check, ExternalLink, Copy } from "lucide-react";
import { PageHeader, Card, ErrorBox } from "@/components/ui";
import { Select } from "@/components/Select";
import { useFetch, api } from "@/lib/client";
import { useRole } from "@/lib/client";

// ---------------------------------------------------------------------------
// TV Displays — set up each screen in the shop.
//
// A shop has more than one TV and they do different jobs. Rather than ask the
// owner to type URL parameters, this page BUILDS the link: choose what a screen
// should show, then open or copy its address on that TV once. The TV keeps that
// address forever, so nothing has to be paired, registered or kept in sync, and
// a replacement TV is live the moment someone types the link.
// ---------------------------------------------------------------------------

type Layout = "split" | "queue" | "ads";

type Business = {
  name?: string;
  queueSettings?: {
    maxPerLetter?: number;
    resetDaily?: boolean;
    voice?: boolean;
    voiceLang?: string;
    lateAfterMins?: number;
  };
};

const LAYOUTS: { value: Layout; label: string; blurb: string }[] = [
  { value: "split", label: "Advert + queue numbers", blurb: "Promotion fills the screen with the numbers down one side. Best over the seating area." },
  { value: "queue", label: "Queue numbers only", blurb: "No advert — numbers as large as the screen allows. Best directly above the counter." },
  { value: "ads", label: "Adverts only", blurb: "Promotions with no numbers at all. For a screen customers see on the way in." },
];

export default function TvDisplaysPage() {
  const role = useRole();
  const isOwner = role === "owner";
  const { data: business, reload } = useFetch<Business>("/api/business");

  // --- the link builder ---
  const [layout, setLayout] = useState<Layout>("split");
  const [railLeft, setRailLeft] = useState(false);
  const [voice, setVoice] = useState(false);
  const [ready, setReady] = useState("");
  const [prep, setPrep] = useState("");
  const [copied, setCopied] = useState(false);

  // --- store-wide queue rules ---
  const [maxPerLetter, setMaxPerLetter] = useState("99");
  const [resetDaily, setResetDaily] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-US");
  const [lateAfter, setLateAfter] = useState("10");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = business?.queueSettings;
    if (!q) return;
    setMaxPerLetter(String(q.maxPerLetter ?? 99));
    setResetDaily(q.resetDaily !== false);
    setVoiceOn(!!q.voice);
    setVoiceLang(q.voiceLang || "en-US");
    setLateAfter(String(q.lateAfterMins ?? 10));
  }, [business]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (layout !== "split") p.set("mode", layout);
    if (railLeft && layout === "split") p.set("rail", "left");
    if (voice && layout !== "ads") p.set("voice", "1");
    if (ready.trim() && layout !== "ads") p.set("ready", ready.trim());
    if (prep.trim() && layout !== "ads") p.set("prep", prep.trim());
    const qs = p.toString();
    return `/queue-display${qs ? `?${qs}` : ""}`;
  }, [layout, railLeft, voice, ready, prep]);

  const fullUrl = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api("/api/business", {
        method: "PATCH",
        body: JSON.stringify({
          queueSettings: {
            maxPerLetter: Number(maxPerLetter) || 99,
            resetDaily,
            voice: voiceOn,
            voiceLang,
            lateAfterMins: Number(lateAfter) || 10,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="TV Displays"
        subtitle="Set up each screen in the shop, and how pickup numbers behave."
      />

      {err && <ErrorBox message={err} />}

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <Monitor size={16} className="text-brand-600" />
          <h2 className="text-sm font-bold text-ink-900">Set up a screen</h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="label">What should this TV show?</label>
              <div className="space-y-2">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLayout(l.value)}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                      layout === l.value
                        ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                        layout === l.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300"
                      }`}
                    >
                      {layout === l.value && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink-900">{l.label}</span>
                      <span className="block text-[11.5px] leading-snug text-slate-500">{l.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {layout === "split" && (
              <div>
                <label className="label">Numbers on which side?</label>
                <Select
                  value={railLeft ? "left" : "right"}
                  onChange={(v) => setRailLeft(v === "left")}
                  options={[
                    { value: "right", label: "Right (default)" },
                    { value: "left", label: "Left" },
                  ]}
                />
              </div>
            )}

            {layout !== "ads" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Ready numbers shown</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder={layout === "queue" ? "8" : "5"}
                    value={ready}
                    onChange={(e) => setReady(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div>
                  <label className="label">Preparing shown</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder={layout === "queue" ? "12" : "6"}
                    value={prep}
                    onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
            )}

            {layout !== "ads" && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input
                  type="checkbox"
                  checked={voice}
                  onChange={(e) => setVoice(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                    <Volume2 size={13} /> This screen calls numbers out loud
                  </span>
                  <span className="block text-[11.5px] leading-snug text-slate-500">
                    Turn on for ONE screen only. Two TVs in the same room announcing the same number talk over each
                    other. Also needs the voice switch below.
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* The result: the address to open on that TV. */}
          <div className="space-y-3">
            <div>
              <label className="label">Open this address on the TV</label>
              <div className="flex gap-2">
                <input readOnly value={fullUrl} className="input flex-1 font-mono text-[12px]" />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(fullUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="btn-ghost shrink-0"
                  title="Copy"
                >
                  {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                </button>
                <a href={path} target="_blank" rel="noreferrer" className="btn-primary shrink-0">
                  <ExternalLink size={15} /> Preview
                </a>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
                Type it into the TV&apos;s browser once and leave the page open. It updates itself the moment a cashier
                takes a payment or the kitchen presses Ready — it never needs refreshing.
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="mb-1.5 text-[12px] font-bold text-ink-900">Two TVs, set up the usual way</p>
              <ul className="space-y-1 text-[11.5px] leading-snug text-slate-600">
                <li>
                  <b>Over the counter</b> — &ldquo;Queue numbers only&rdquo;, voice on. The screen people check.
                </li>
                <li>
                  <b>Seating area</b> — &ldquo;Advert + queue numbers&rdquo;, voice off. Promotions, with numbers to
                  hand.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold text-ink-900">Pickup number rules</h2>
        <p className="mb-4 text-[12px] text-slate-500">
          These apply to the whole store — every till draws from one sequence, so a number is never given out twice.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Numbers per letter</label>
            <input
              className="input"
              inputMode="numeric"
              value={maxPerLetter}
              onChange={(e) => setMaxPerLetter(e.target.value.replace(/\D/g, ""))}
              disabled={!isOwner}
            />
            <p className="mt-1 text-[11px] text-slate-400">A001 to A{maxPerLetter || "99"}, then B001.</p>
          </div>
          <div>
            <label className="label">Late warning after</label>
            <input
              className="input"
              inputMode="numeric"
              value={lateAfter}
              onChange={(e) => setLateAfter(e.target.value.replace(/\D/g, ""))}
              disabled={!isOwner}
            />
            <p className="mt-1 text-[11px] text-slate-400">Minutes before the kitchen screen flags an order.</p>
          </div>
          <div>
            <label className="label">Announce voice</label>
            <Select
              value={voiceLang}
              onChange={setVoiceLang}
              disabled={!isOwner}
              options={[
                { value: "en-US", label: "English" },
                { value: "km-KH", label: "Khmer" },
              ]}
            />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-900">
              <input
                type="checkbox"
                checked={resetDaily}
                onChange={(e) => setResetDaily(e.target.checked)}
                disabled={!isOwner}
                className="h-4 w-4 accent-brand-600"
              />
              Start again at A001 each day
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-900">
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={(e) => setVoiceOn(e.target.checked)}
                disabled={!isOwner}
                className="h-4 w-4 accent-brand-600"
              />
              Call numbers out loud
            </label>
          </div>
        </div>

        {isOwner && (
          <div className="mt-4 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save rules"}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        )}
        {!isOwner && <p className="mt-4 text-[12px] text-slate-500">Only the owner can change these rules.</p>}
      </Card>
    </div>
  );
}
