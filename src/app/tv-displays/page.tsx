"use client";

import { useEffect, useMemo, useState } from "react";
import { Monitor, Volume2, Check, ExternalLink, Copy, Upload, Image as ImageIcon } from "lucide-react";
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

type Layout = "board" | "split" | "ads";

type Business = {
  name?: string;
  queueSettings?: {
    maxPerLetter?: number;
    resetDaily?: boolean;
    voice?: boolean;
    voiceLang?: string;
    lateAfterMins?: number;
    boardLogo?: string;
    accent?: string;
    boardNote?: string;
  };
};

const ACCENTS = ["#2544c7", "#0ea5e9", "#7c3aed", "#059669", "#dc2626", "#ea580c", "#0f172a"];

const LAYOUTS: { value: Layout; label: string; blurb: string }[] = [
  {
    value: "board",
    label: "Queue board",
    blurb: "Now serving · Preparing · Order ready, the way your board looks today. Best directly above the counter.",
  },
  {
    value: "split",
    label: "Advert + queue board",
    blurb: "Your promotion beside the board. Best over the seating area, where people are waiting.",
  },
  {
    value: "ads",
    label: "Adverts only",
    blurb: "Promotions with no numbers — for a menu screen, like the one by your noodle counter.",
  },
];

export default function TvDisplaysPage() {
  const role = useRole();
  const isOwner = role === "owner";
  const { data: business, reload } = useFetch<Business>("/api/business");

  // --- the link builder ---
  const [layout, setLayout] = useState<Layout>("board");
  const [dark, setDark] = useState(false);
  const [voice, setVoice] = useState(false);
  const [rows, setRows] = useState("");
  const [copied, setCopied] = useState(false);

  // --- store-wide queue rules ---
  const [maxPerLetter, setMaxPerLetter] = useState("99");
  const [resetDaily, setResetDaily] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-US");
  const [lateAfter, setLateAfter] = useState("10");
  const [boardLogo, setBoardLogo] = useState<string>("");
  const [accent, setAccent] = useState("#2544c7");
  const [boardNote, setBoardNote] = useState("");
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
    setBoardLogo(q.boardLogo || "");
    setAccent(q.accent || "#2544c7");
    setBoardNote(q.boardNote || "");
  }, [business]);

  // Downscale before storing: a phone photo is several MB, and the whole store
  // document is rewritten on every sale — an oversized picture would slow every
  // transaction in the shop, not just this screen.
  async function pickLogo(file: File) {
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = dataUrl;
    });
    const MAX_W = 600;
    const scale = Math.min(1, MAX_W / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    // PNG keeps a logo's transparent background; JPEG would put a white box
    // behind it on a dark board.
    setBoardLogo(c.toDataURL("image/png"));
  }

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (layout !== "board") p.set("mode", layout); // board is the default
    if (dark) p.set("theme", "dark");
    if (voice && layout !== "ads") p.set("voice", "1");
    if (rows.trim() && layout !== "ads") p.set("rows", rows.trim());
    const qs = p.toString();
    return `/queue-display${qs ? `?${qs}` : ""}`;
  }, [layout, dark, voice, rows]);

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
            boardLogo,
            accent,
            boardNote,
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Background</label>
                <Select
                  value={dark ? "dark" : "light"}
                  onChange={(v) => setDark(v === "dark")}
                  options={[
                    { value: "light", label: "Light (matches your board)" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </div>
              {layout !== "ads" && (
                <div>
                  <label className="label">Rows per column</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="7"
                    value={rows}
                    onChange={(e) => setRows(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              )}
            </div>

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
        <h2 className="mb-1 text-sm font-bold text-ink-900">How the board looks</h2>
        <p className="mb-4 text-[12px] text-slate-500">
          Applies to every queue TV in this store.
        </p>

        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <label className="label">Picture under the number</label>
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
                {boardLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={boardLogo} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImageIcon size={18} className="text-slate-300" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="btn-ghost cursor-pointer text-[12px]">
                  <Upload size={13} /> Choose picture
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!isOwner}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) pickLogo(f).catch(() => setErr("Couldn't read that image."));
                      e.target.value = "";
                    }}
                  />
                </label>
                {boardLogo && (
                  <button type="button" onClick={() => setBoardLogo("")} className="text-left text-[11.5px] text-rose-600">
                    Remove
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              Your logo, shown small beneath the called number. Shrunk automatically so it can&apos;t slow the tills down.
            </p>
          </div>

          <div>
            <label className="label">Number colour</label>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!isOwner}
                  onClick={() => setAccent(c)}
                  aria-label={c}
                  className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition ${
                    accent.toLowerCase() === c ? "ring-ink-900" : "ring-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={accent}
                disabled={!isOwner}
                onChange={(e) => setAccent(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white"
                title="Any colour"
              />
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preview</span>
              <span className="text-2xl font-black tabular-nums" style={{ color: accent }}>
                A001
              </span>
            </div>
          </div>

          <div>
            <label className="label">Message under the number</label>
            <input
              className="input"
              value={boardNote}
              disabled={!isOwner}
              maxLength={80}
              placeholder="e.g. Please collect at the counter"
              onChange={(e) => setBoardNote(e.target.value)}
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              Optional. Leave empty to show nothing.
            </p>
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
