"use client";

import { useEffect, useState } from "react";
import { Monitor, Volume2, Check, ExternalLink, Copy, Upload, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { PageHeader, Card, ErrorBox } from "@/components/ui";
import { Select } from "@/components/Select";
import { useFetch, api } from "@/lib/client";
import { useRole } from "@/lib/client";

// ---------------------------------------------------------------------------
// TV Displays — set up each screen in the shop.
//
// A shop has more than one TV and they do different jobs — one over the counter
// showing numbers, one in the seating area showing promotions, one as a menu
// board. Each is registered here and gets a short link (?screen=s2) opened on
// that TV once.
//
// WHAT a screen shows is stored on the server against its id, not baked into the
// link. So re-pointing the seating-area TV from adverts to the board is done
// from the office and the screen follows on its own — nobody carries a keyboard
// over to a wall-mounted television. Replacing a broken TV is just opening the
// same link on the new one.
// ---------------------------------------------------------------------------

type Layout = "board" | "split" | "ads";

type Screen = {
  id: string;
  name: string;
  mode: Layout;
  dark?: boolean;
  rows?: number;
  voice?: boolean;
};

type Business = {
  name?: string;
  queueSettings?: {
    screens?: Screen[];
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

  // --- the shop's TVs ---
  const [screens, setScreens] = useState<Screen[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    setScreens(q.screens?.length ? q.screens : []);
  }, [business]);

  // Ids only have to be unique within one store and never change once a TV has
  // the link, so the lowest unused sN is both stable and readable.
  function addScreen() {
    const taken = new Set(screens.map((s) => s.id));
    let n = 1;
    while (taken.has(`s${n}`)) n++;
    setScreens([
      ...screens,
      { id: `s${n}`, name: `TV ${screens.length + 1}`, mode: "board", dark: false, rows: 7, voice: false },
    ]);
  }
  const patchScreen = (id: string, patch: Partial<Screen>) =>
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeScreen = (id: string) => setScreens((prev) => prev.filter((s) => s.id !== id));

  const linkFor = (id: string) =>
    typeof window === "undefined" ? `/queue-display?screen=${id}` : `${window.location.origin}/queue-display?screen=${id}`;

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

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api("/api/business", {
        method: "PATCH",
        body: JSON.stringify({
          queueSettings: {
            screens,
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
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-brand-600" />
            <h2 className="text-sm font-bold text-ink-900">Your screens</h2>
          </div>
          {isOwner && (
            <button type="button" onClick={addScreen} className="btn-ghost text-[12px]">
              <Plus size={14} /> Add a TV
            </button>
          )}
        </div>
        <p className="mb-4 text-[12px] text-slate-500">
          One entry per TV in the shop. Open its link on that screen once and leave it — changing what it shows here
          takes effect on the TV by itself, so nobody has to go back to it with a keyboard.
        </p>

        {screens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
            <p className="text-[13px] font-semibold text-ink-900">No screens set up yet</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-slate-500">
              Add one for each TV — for example &ldquo;Over the counter&rdquo; and &ldquo;Seating area&rdquo;. Any screen
              opened without a link still shows the standard board.
            </p>
            {isOwner && (
              <button type="button" onClick={addScreen} className="btn-primary mt-3">
                <Plus size={14} /> Add a TV
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {screens.map((sc) => (
              <div key={sc.id} className="rounded-xl border border-slate-200 p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <input
                    className="input flex-1 font-semibold"
                    value={sc.name}
                    disabled={!isOwner}
                    maxLength={40}
                    placeholder="Where is this TV?"
                    onChange={(e) => patchScreen(sc.id, { name: e.target.value })}
                  />
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => removeScreen(sc.id)}
                      className="btn-ghost shrink-0 text-rose-600"
                      title="Remove this TV"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="lg:col-span-2">
                    <label className="label">Shows</label>
                    <Select
                      value={sc.mode}
                      disabled={!isOwner}
                      onChange={(v) => patchScreen(sc.id, { mode: v as Layout })}
                      options={LAYOUTS.map((l) => ({ value: l.value, label: l.label }))}
                    />
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">
                      {LAYOUTS.find((l) => l.value === sc.mode)?.blurb}
                    </p>
                  </div>
                  <div>
                    <label className="label">Background</label>
                    <Select
                      value={sc.dark ? "dark" : "light"}
                      disabled={!isOwner}
                      onChange={(v) => patchScreen(sc.id, { dark: v === "dark" })}
                      options={[
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="label">Rows per column</label>
                    <input
                      className="input"
                      inputMode="numeric"
                      disabled={!isOwner || sc.mode === "ads"}
                      value={sc.mode === "ads" ? "" : String(sc.rows ?? 7)}
                      placeholder={sc.mode === "ads" ? "—" : "7"}
                      onChange={(e) => patchScreen(sc.id, { rows: Number(e.target.value.replace(/\D/g, "")) || 7 })}
                    />
                  </div>
                </div>

                {sc.mode !== "ads" && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={!!sc.voice}
                      disabled={!isOwner}
                      onChange={(e) => patchScreen(sc.id, { voice: e.target.checked })}
                      className="mt-0.5 h-4 w-4 accent-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
                        <Volume2 size={13} /> This screen calls numbers out loud
                      </span>
                      <span className="block text-[11px] leading-snug text-slate-500">
                        Turn on for one screen only — two TVs in the same room announce over each other.
                      </span>
                    </span>
                  </label>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <input readOnly value={linkFor(sc.id)} className="input flex-1 font-mono text-[11.5px]" />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    title="Copy the link"
                    onClick={() => {
                      navigator.clipboard?.writeText(linkFor(sc.id));
                      setCopiedId(sc.id);
                      setTimeout(() => setCopiedId(null), 1800);
                    }}
                  >
                    {copiedId === sc.id ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                  </button>
                  <a
                    href={`/queue-display?screen=${sc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary shrink-0"
                  >
                    <ExternalLink size={15} /> Preview
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {screens.some((s) => s.voice) && screens.filter((s) => s.voice).length > 1 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 ring-1 ring-amber-200">
            {screens.filter((s) => s.voice).length} screens are set to speak. In one room they will talk over each
            other — leave it on for just one.
          </p>
        )}
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
