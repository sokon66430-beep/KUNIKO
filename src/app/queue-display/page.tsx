"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playChime, audioBlocked, unlockAudio } from "@/lib/chimes";
import { localizeQueueCode, type QueueNumberStyle } from "@/lib/khmer";
import { speakQueueCode } from "@/lib/announce";

// ---------------------------------------------------------------------------
// Customer queue TV.
//
// Modelled on the board ON Mart already runs in-store, because staff and
// customers have learnt it: light background, Khmer above English, and three
// columns — NOW SERVING · PREPARING · ORDER READY — with the number just called
// held large on the left. Changing that layout would cost recognition for no
// gain, so this reproduces it and drives it from live data instead of a
// separate system.
//
// It stays fresh from the SSE feed and never needs a refresh. EventSource
// reconnects on its own and we refetch on every reconnect, so a screen left
// running for a week is still correct.
// ---------------------------------------------------------------------------

type Entry = { id: string; code: string; at: string; where: string };
type Board = {
  storeName: string;
  logo: string | null;
  ads: string[];
  adSeconds: number;
  boardLogo: string | null;
  accent: string;
  boardNote: string;
  screen: {
    id: string;
    name: string;
    mode: Mode;
    dark: boolean;
    rows: number;
    voice: boolean;
    chime: string;
    volume: number;
  } | null;
  preparing: Entry[];
  ready: Entry[];
  voice: boolean;
  voiceLang: string;
  chime: string;
  volume: number;
  numberStyle: QueueNumberStyle;
};

const ROWS = 7; // what fits a 16:9 screen at this row height, matching the existing board

// ---------------------------------------------------------------------------
// The three column icons.
//
// Emoji, not drawn icons. Tried both: hand-drawn silhouettes are tidier on
// paper, but on a board glanced at from across a shop the emoji win — they are
// already the shapes people know, they carry their own colour, and a customer
// reads "pan" and "bag" faster than any icon set we could draw.
//
// The trade worth knowing: the exact drawing belongs to the device, so the pan
// looks slightly different on an Android TV box than in a desktop preview. The
// meaning doesn't change, which is all this has to do.
// ---------------------------------------------------------------------------
const ICON = {
  // A megaphone — this number is being CALLED.
  now: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 10h2.6l9-4.6a.8.8 0 0 1 1.2.7v11.8a.8.8 0 0 1-1.2.7l-9-4.6H5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2Z" />
      <path d="M8.2 15.5 9.4 19.6a1 1 0 0 0 1 .7h.8a1 1 0 0 0 1-1.3l-1-3.3" />
      <path d="M20.4 10.3a3.2 3.2 0 0 1 0 3.4" />
    </svg>
  ),
  // A pan on the heat with steam — this order is being MADE.
  preparing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.2 12.2h13.2v1.6a6.2 6.2 0 0 1-6.2 6.2H9.4a6.2 6.2 0 0 1-6.2-6.2v-1.6Z" />
      <path d="M16.4 13.4h3a1.8 1.8 0 0 1 0 3.6h-1.2" />
      <path className="q-steam" d="M7.6 9.2c.85-1.1.85-1.9 0-3" />
      <path className="q-steam q-steam-2" d="M11.8 9.2c.85-1.1.85-1.9 0-3" />
    </svg>
  ),
  // A takeaway box — this order is DONE and waiting to be collected.
  ready: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.6 8.7h12.8l-1.1 10a2 2 0 0 1-2 1.8H8.7a2 2 0 0 1-2-1.8l-1.1-10Z" />
      <path d="M4.6 8.7 12 4.9l7.4 3.8" />
      <path d="M9.4 5.7a2.6 2.6 0 0 1 5.2 0" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Which TV this is.
//
// The normal way is a registered screen: the TV opens /queue-display?screen=s2
// once and never changes, while WHAT it shows is stored on the server against
// that id. So the owner re-points the seating-area TV from adverts to the board
// from the office, and the screen follows on its next update — nobody carries a
// keyboard over to it.
//
// The raw parameters below still work for a screen that was never registered,
// so a spare TV or a quick preview needs no setup at all:
//
//   /queue-display                → the three-column board (default)
//   /queue-display?mode=ads       → promotions only, for a menu screen
//   /queue-display?mode=split     → advert beside the board
//   /queue-display?theme=dark     → dark board
//   /queue-display?voice=1        → THIS screen speaks (turn on for ONE only)
// ---------------------------------------------------------------------------
type Mode = "board" | "split" | "ads";
function readScreenConfig(search: string) {
  const p = new URLSearchParams(search);
  const raw = (p.get("mode") || "board").toLowerCase();
  const mode: Mode = raw === "ads" || raw === "split" ? raw : "board";
  const n = (key: string, fb: number, max: number) => {
    const v = Number(p.get(key));
    return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : fb;
  };
  return {
    mode,
    dark: (p.get("theme") || "light").toLowerCase() === "dark",
    // Off by default: two TVs in earshot both announcing is worse than neither.
    voice: p.get("voice") === "1" || p.get("voice") === "on",
    rows: n("rows", ROWS, 12),
  };
}

export default function QueueDisplayPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState({ time: "", date: "" });
  const [ad, setAd] = useState(0);
  const [urlCfg, setUrlCfg] = useState(() => readScreenConfig(""));
  useEffect(() => setUrlCfg(readScreenConfig(window.location.search)), []);
  // A registered screen's stored setup wins over the URL, so re-pointing a TV
  // from the office takes effect without anyone touching the screen.
  const s = board?.screen;
  const cfg = s
    ? { mode: s.mode, dark: s.dark, voice: s.voice, rows: Math.min(12, Math.max(1, s.rows)) }
    : urlCfg;

  // Latin in the data, Khmer on the glass. Every number on this screen goes
  // through here, so the board can't end up half-translated.
  const style: QueueNumberStyle = (board?.numberStyle as QueueNumberStyle) || "latin";
  const show = (code: string) => localizeQueueCode(code, style);

  const announced = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const voiceRef = useRef(false);
  useEffect(() => {
    voiceRef.current = cfg.voice;
  }, [cfg.voice]);

  // The chime is read through a ref because load() is created once: without it
  // a screen would keep playing whatever sound was set when it was opened.
  const soundRef = useRef({ chime: "ding", volume: 80 });
  useEffect(() => {
    soundRef.current = {
      // An adverts-only screen shows no numbers, so it has no business chiming
      // about them — that's the seating-area TV startling the room.
      chime: cfg.mode === "ads" ? "none" : (board?.screen?.chime ?? board?.chime ?? "ding"),
      volume: board?.screen?.volume ?? board?.volume ?? 80,
    };
  }, [board, cfg.mode]);

  // Browsers won't make a sound until someone has touched the page, and a TV is
  // opened once and then left alone. Without this a shop would pick a chime,
  // hear nothing all day, and reasonably conclude it doesn't work.
  const [needsTap, setNeedsTap] = useState(false);
  useEffect(() => {
    const check = () => setNeedsTap(audioBlocked() && soundRef.current.chime !== "none");
    check();
    const t = setInterval(check, 5_000);
    return () => clearInterval(t);
  }, []);
  const enableSound = useCallback(async () => {
    if (await unlockAudio()) {
      setNeedsTap(false);
      playChime(soundRef.current.chime, soundRef.current.volume); // confirm it audibly
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const id = new URLSearchParams(window.location.search).get("screen") || "";
      const r = await fetch(`/api/queue/board${id ? `?screen=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      const next: Board = await r.json();
      setBoard(next);

      const fresh = next.ready.filter((e) => !announced.current.has(e.code));
      if (firstLoad.current) {
        // Seed silently, so opening the screen doesn't chime and read out every
        // number already on the board.
        next.ready.forEach((e) => announced.current.add(e.code));
        firstLoad.current = false;
      } else if (fresh.length) {
        fresh.forEach((e) => announced.current.add(e.code));
        // ONE chime, however many orders turned ready at once. Two tills
        // finishing together must not make the shop sound like an alarm.
        playChime(soundRef.current.chime, soundRef.current.volume);
        // The voice is separate and optional: the bell says "look up", the
        // voice says which number. Delayed so it doesn't talk over the bell.
        if (next.voice && voiceRef.current) {
          window.setTimeout(() => {
            for (const e of fresh) {
              void speakQueueCode(e.code, {
                lang: next.voiceLang,
                style: (next.numberStyle as QueueNumberStyle) || "latin",
              });
            }
          }, 900);
        }
      }
      const onBoard = new Set(next.ready.map((e) => e.code));
      announced.current.forEach((c) => {
        if (!onBoard.has(c)) announced.current.delete(c);
      });
    } catch {
      /* transient — the SSE reconnect triggers another load */
    }
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/queue/stream");
    es.addEventListener("ready", () => {
      setLive(true);
      load(); // resync on every (re)connect, so a missed event can't leave stale
    });
    es.addEventListener("queue:changed", () => load());
    es.onerror = () => setLive(false); // EventSource retries by itself
    const poll = setInterval(load, 60_000); // slow safety net
    const tick = setInterval(() => {
      const d = new Date();
      setNow({
        time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-"),
      });
    }, 1000);
    return () => {
      es.close();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const ads = board?.ads ?? [];
  const adSeconds = board?.adSeconds || 6;
  useEffect(() => {
    if (ads.length < 2) return;
    const t = setInterval(() => setAd((i) => (i + 1) % ads.length), Math.max(2, adSeconds) * 1000);
    return () => clearInterval(t);
  }, [ads.length, adSeconds]);

  // The most recently readied order is the one being CALLED; the rest are
  // waiting to be collected. That's what the existing board does, and it's why
  // "Now serving" is a single number rather than a list.
  const readyAll = [...(board?.ready ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const nowServing = readyAll[0] || null;
  const alsoReady = readyAll.slice(1, 1 + cfg.rows);
  const preparing = (board?.preparing ?? []).slice(0, cfg.rows);

  const AdPanel = (
    <section className="q-ad">
      {ads.length > 0 ? (
        ads.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" className={`q-ad-img ${i === ad ? "show" : ""}`} />
        ))
      ) : (
        <div className="q-ad-fallback">
          {board?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={board.logo} alt="" className="q-ad-logo" />
          ) : null}
          <p className="q-ad-name">{board?.storeName || ""}</p>
        </div>
      )}
    </section>
  );

  if (cfg.mode === "ads") {
    return (
      <div className={`q ${cfg.dark ? "dark" : ""} mode-ads`}>
        {AdPanel}
        <Style />
      </div>
    );
  }

  const BoardPanel = (
    <div className="q-board">
      {/* NOW SERVING — the hero, exactly as the in-store board shows it. */}
      <section className="q-col q-col-now">
        <h2 className="q-h">
          <span className="q-ico q-ico-now" aria-hidden>
            {ICON.now}
          </span>
          <span className="q-kh">កំពុងហៅ</span>
          <span className="q-en">NOW SERVING</span>
        </h2>
        <div className="q-now-wrap">
          {/* `key` is the code, so React replaces this element whenever the
              number changes and the pop animation plays again. Without it the
              same element would just have its text swapped and a customer who
              glanced away would never know a new number had been called. */}
          <span key={nowServing?.code || "none"} className={`q-now ${nowServing ? "has" : ""}`}>
            {nowServing ? show(nowServing.code) : "—"}
          </span>
        </div>
        {board?.boardNote ? <p className="q-note">{board.boardNote}</p> : null}
        {/* Clock and shop name. They used to be three loose lines of text
            floating in the corner; gathered into one soft pill they read as a
            deliberate part of the board instead of something left over. */}
        <div className="q-foot">
          <div className="q-clockcard">
            <span className="q-time">{now.time}</span>
            <span className="q-date">{now.date}</span>
            {board?.boardLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={board.boardLogo} alt="" className="q-board-logo" />
            ) : (
              <span className="q-brand">
                <span className={`q-dot ${live ? "on" : "off"}`} aria-hidden />
                {board?.storeName || ""}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="q-col">
        <h2 className="q-h">
          <span className="q-ico q-ico-prep" aria-hidden>
            {ICON.preparing}
          </span>
          <span className="q-kh">កំពុងរៀបចំ</span>
          <span className="q-en">PREPARING</span>
        </h2>
        <ul className="q-list">
          {preparing.map((e) => (
            <li key={e.id} className="q-row q-in">
              <span className="q-where">{e.where}</span>
              <span className="q-code">{show(e.code)}</span>
            </li>
          ))}
          {preparing.length === 0 && <li className="q-row q-row-empty">—</li>}
        </ul>
      </section>

      <section className="q-col q-col-ready">
        <h2 className="q-h">
          <span className="q-ico q-ico-ready" aria-hidden>
            {ICON.ready}
          </span>
          <span className="q-kh">រួចរាល់</span>
          <span className="q-en">ORDER READY</span>
        </h2>
        <ul className="q-list">
          {alsoReady.map((e) => (
            <li key={e.id} className="q-row q-in">
              <span className="q-where">{e.where}</span>
              <span className="q-code q-code-ready">{show(e.code)}</span>
            </li>
          ))}
          {alsoReady.length === 0 && <li className="q-row q-row-empty">—</li>}
        </ul>
      </section>
    </div>
  );

  return (
    <div
      className={`q ${cfg.dark ? "dark" : ""} mode-${cfg.mode}`}
      style={{ ["--q-accent" as any]: board?.accent || "#2544c7" }}
    >
      {cfg.mode === "split" && AdPanel}
      {BoardPanel}
      {/* Shown once, the first time this screen is set up, and never again on
          that TV. Small and in the corner: if nobody presses it the board still
          works perfectly, it is just silent. */}
      {needsTap && (
        <button className="q-sound" onClick={enableSound}>
          🔔 Tap once to turn on sound
        </button>
      )}
      <Style />
    </div>
  );
}

function Style() {
  return (
    <style jsx global>{`
      html,
      body {
        margin: 0;
        overflow: hidden;
        background: #eceef7;
      }
      /* ---------------------------------------------------------------------
         Motion.
         This board is watched by someone eating, queueing, or looking at their
         phone. Movement is what pulls a glance back — a number that merely
         appears is a number that gets missed. So the called number lands with a
         bounce and then breathes gently, and each row slides in as it arrives.

         Kept slow and soft on purpose: a screen that runs all day in a shop
         should be noticeable, never annoying, and nothing loops fast enough to
         become the thing you can't stop looking at.
      --------------------------------------------------------------------- */
      @keyframes qPop {
        0% {
          transform: scale(0.55) translateY(0.1em);
          opacity: 0;
        }
        55% {
          transform: scale(1.12) translateY(0);
          opacity: 1;
        }
        75% {
          transform: scale(0.97);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }
      /* The slow breath afterwards, so the number still reads as "live" minutes
         later when nothing has changed. */
      @keyframes qBreathe {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.035);
        }
      }
      @keyframes qHalo {
        0%,
        100% {
          opacity: 0.16;
          transform: translate(-50%, -50%) scale(1);
        }
        50% {
          opacity: 0.05;
          transform: translate(-50%, -50%) scale(1.25);
        }
      }
      @keyframes qSlideIn {
        from {
          opacity: 0;
          transform: translateX(0.6em);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      .q-now.has {
        /* pop once on arrival, then breathe for ever */
        animation:
          qPop 0.75s cubic-bezier(0.34, 1.56, 0.64, 1) both,
          qBreathe 3.6s ease-in-out 0.75s infinite;
        transform-origin: center;
      }
      /* A soft halo behind the called number. Purely decorative, so it sits
         behind everything and never takes a click or affects layout. */
      .q-now-wrap {
        position: relative;
      }
      .q-now-wrap::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 1.6em;
        height: 1.6em;
        border-radius: 50%;
        background: var(--q-accent, #2544c7);
        transform: translate(-50%, -50%);
        animation: qHalo 3.6s ease-in-out infinite;
        pointer-events: none;
        z-index: 0;
      }
      .q-now {
        position: relative;
        z-index: 1;
      }
      .q-in {
        animation: qSlideIn 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) both;
      }
      /* A ready number is the one a customer is waiting for, so it gets a small
         nudge of its own rather than sharing the preparing column's entrance. */
      .q-code-ready {
        animation: qPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        display: inline-block;
      }
      /* Some people get motion sick, and a board is not something you can look
         away from while you wait for your food. Honour the system setting. */
      @media (prefers-reduced-motion: reduce) {
        .q-now.has,
        .q-now-wrap::before,
        .q-in,
        .q-code-ready {
          animation: none;
        }
      }
      /* Column icons. Sized from the heading so they track the text on any TV
         rather than needing a breakpoint per screen size. */
      /* The emoji on its own — no badge, no disc behind it. A filled circle in
         each column's colour turned the headings into three traffic lights and
         competed with the numbers, which are the thing to look at.

         Sized against the VIEWPORT rather than the heading text: the headings
         are deliberately small so the numbers can be big, but an icon read from
         across a shop has to be big in its own right. */
      .q-ico {
        display: block;
        margin: 0 auto 0.5vh;
        width: min(5.4vh, 3.6vw);
        height: min(5.4vh, 3.6vw);
        transform-origin: center bottom;
      }
      .q-ico svg {
        width: 100%;
        height: 100%;
        /* Line weight is set on the SVG, but stroke SCALES with the viewBox, so
           on a big TV the lines would fatten into a filled blob. vector-effect
           holds them at a constant width whatever size the board is drawn at. */
        vector-effect: non-scaling-stroke;
      }
      /* Each one moves differently, so the three columns read as three separate
         things happening rather than one animation copied three times. */
      .q-ico-now {
        color: var(--q-accent, #2544c7);
        animation: qShout 3.2s ease-in-out infinite;
      }
      .q-ico-prep {
        color: #d97706;
        animation: qSizzle 2.2s ease-in-out infinite;
      }
      .q-ico-ready {
        color: #059669;
        animation: qNudge 4s ease-in-out infinite;
      }
      /* Steam rising off the pan — the one thing on the board that says work is
         happening out of sight. */
      @keyframes qSteam {
        0%,
        100% {
          opacity: 0.3;
          transform: translateY(1px);
        }
        50% {
          opacity: 1;
          transform: translateY(-1.5px);
        }
      }
      .q-steam {
        animation: qSteam 2.4s ease-in-out infinite;
      }
      .q-steam-2 {
        animation-delay: 0.9s;
      }
      /* The megaphone tips as if calling out. */
      @keyframes qShout {
        0%,
        70%,
        100% {
          transform: rotate(0deg) scale(1);
        }
        78% {
          transform: rotate(-9deg) scale(1.1);
        }
        86% {
          transform: rotate(7deg) scale(1.1);
        }
        94% {
          transform: rotate(-3deg) scale(1.04);
        }
      }
      /* The pan shakes the way a pan does — small, quick, never still. */
      @keyframes qSizzle {
        0%,
        100% {
          transform: translate(0, 0) rotate(0deg);
        }
        25% {
          transform: translate(-0.03em, -0.05em) rotate(-3deg);
        }
        50% {
          transform: translate(0.03em, 0) rotate(3deg);
        }
        75% {
          transform: translate(-0.02em, -0.03em) rotate(-2deg);
        }
      }
      /* The takeaway box hops once in a while — a nudge to come and collect. */
      @keyframes qNudge {
        0%,
        84%,
        100% {
          transform: translateY(0) scale(1);
        }
        90% {
          transform: translateY(-0.18em) scale(1.06);
        }
        95% {
          transform: translateY(0) scale(0.98);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .q-ico-now,
        .q-ico-prep,
        .q-ico-ready {
          animation: none;
        }
      }
      .q-sound {
        position: fixed;
        right: 1.2vw;
        bottom: 1.2vw;
        z-index: 20;
        border: 0;
        border-radius: 999px;
        padding: 0.9vh 1.6vw;
        font: inherit;
        font-size: min(2.1vh, 1.4vw);
        font-weight: 700;
        color: #fff;
        background: rgba(20, 24, 45, 0.86);
        cursor: pointer;
      }
      .q {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-columns: 1fr;
        background: #eceef7;
        color: #12183a;
        /* Latin then the shared Khmer stack (globals.css), so កំពុងហៅ / រួចរាល់
           render in the store's typeface rather than whatever Khmer face the TV
           happens to ship with. */
        font-family: var(--font-sans), var(--font-khmer);
        user-select: none;
      }
      .q.dark {
        background: #0a0f1e;
        color: #e8edf9;
      }
      /* The board is three columns and has to stay readable, so it takes about
         two thirds and the advert gets what's left. An even split squeezed the
         headings until "ORDER READY" wrapped onto two lines. */
      .q.mode-split {
        grid-template-columns: 1fr 2.1fr;
      }
      /* Tighter gutters and slightly smaller type, since each column here is
         narrower than on a board-only screen. */
      .q.mode-split .q-col {
        padding: 2.2vh 1vw 1.6vh;
      }
      .q.mode-split .q-kh {
        font-size: 2.4vh;
      }
      .q.mode-split .q-en {
        font-size: 1.9vh;
      }
      .q.mode-split .q-code {
        font-size: 3.6vh;
      }
      .q.mode-split .q-where {
        font-size: 1.5vh;
      }
      /* Headings must not wrap: two-line column titles make the board look
         broken from across a room. */
      .q.mode-split .q-en,
      .q.mode-split .q-kh {
        white-space: nowrap;
      }
      .q.mode-ads {
        grid-template-columns: 1fr;
      }

      /* ---- Advert ---- */
      .q-ad {
        position: relative;
        overflow: hidden;
        background: #0b1020;
      }
      .q-ad-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0;
        transition: opacity 900ms ease;
      }
      .q-ad-img.show {
        opacity: 1;
      }
      .q-ad-fallback {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2.4vh;
        background: radial-gradient(900px 520px at 30% 10%, rgba(37, 99, 235, 0.25), transparent 60%), #0b1020;
        color: #fff;
      }
      .q-ad-logo {
        height: 16vh;
        width: auto;
        object-fit: contain;
      }
      .q-ad-name {
        margin: 0;
        font-size: 5vh;
        font-weight: 900;
        text-align: center;
        padding: 0 4vw;
      }

      /* ---- Board ---- */
      .q-board {
        display: grid;
        grid-template-columns: 1.15fr 1fr 1fr;
        min-height: 0;
      }
      .q-col {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-left: 1px solid rgba(18, 24, 58, 0.1);
        padding: 2.6vh 1.6vw 2vh;
      }
      .q.dark .q-col {
        border-left-color: rgba(255, 255, 255, 0.1);
      }
      .q-col:first-child {
        border-left: none;
      }
      .q-h {
        margin: 0 0 1.6vh;
        text-align: center;
        line-height: 1.15;
        display: flex;
        flex-direction: column;
        gap: 0.2vh;
      }
      .q-kh {
        font-size: 3.1vh;
        /* 700, not 800: neither Niradei nor Kantumruy Pro ships heavier, and
           asking for more makes the browser SYNTHESISE a bolder face, which
           smears Khmer diacritics — worse than the real Bold on a screen read
           from across a room. */
        font-weight: 700;
        font-family: var(--font-khmer);
        line-height: 1.35; /* Khmer needs room above/below for its marks */
      }
      .q-en {
        font-size: 2.5vh;
        font-weight: 800;
        letter-spacing: 0.02em;
      }

      /* Now serving */
      .q-col-now {
        justify-content: space-between;
      }
      .q-now-wrap {
        flex: 1;
        display: grid;
        place-items: center;
        min-height: 0;
      }
      .q-now {
        /* Bounded by the COLUMN's width as well as the screen height. Sized on
           height alone, a four-character code like A001 ran past the divider and
           clipped its last digit — the number is ~2.6em wide and this column is
           roughly a third of the screen, so the width limit is what binds on a
           16:9 TV. min() takes whichever is smaller, so it fits either way. */
        font-size: min(19vh, 11.5vw);
        font-weight: 900;
        line-height: 0.95;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
        color: #c9cee4;
        max-width: 100%;
        white-space: nowrap;
      }
      .q-now.has {
        color: var(--q-accent, #2544c7);
        /* The motion itself is defined once, further up (qPop + qBreathe). This
           rule used to carry its own plain fade, which — being later in the
           sheet — quietly won and left the number static between calls. */
      }
      .q-foot {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.9vh;
      }
      /* No card, no box. Tried a white panel here and it read as a sticker
         pasted onto the board — the corner is quiet information, and giving it
         a surface of its own made it shout. Plain type on the background, with
         the spacing doing the grouping instead. */
      .q-clockcard {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.3vh;
      }
      .q-time {
        font-size: 3.6vh;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.015em;
        font-variant-numeric: tabular-nums;
      }
      .q-date {
        font-size: 1.6vh;
        font-weight: 600;
        opacity: 0.4;
        letter-spacing: 0.04em;
        font-variant-numeric: tabular-nums;
      }
      .q-brand {
        margin-top: 1vh;
        display: flex;
        align-items: center;
        gap: 0.5vw;
        font-size: 1.6vh;
        font-weight: 700;
        letter-spacing: 0.03em;
        opacity: 0.55;
      }
      /* The live light breathes. It is the only thing on the board that says
         "this screen is still talking to the till" — a dead dot and a live one
         look identical until one of them moves. */
      @keyframes qBlink {
        0%,
        100% {
          box-shadow: 0 0 0 0.3vh rgba(34, 197, 94, 0.28);
        }
        50% {
          box-shadow: 0 0 0 0.75vh rgba(34, 197, 94, 0);
        }
      }
      .q-dot {
        width: 1vh;
        height: 1vh;
        border-radius: 999px;
        background: #22c55e;
        flex: 0 0 auto;
        animation: qBlink 2.4s ease-out infinite;
      }
      .q-dot.off {
        background: #f59e0b;
        animation: none; /* a screen that has lost the feed shouldn't look busy */
        box-shadow: 0 0 0 0.35vh rgba(245, 158, 11, 0.22);
      }

      /* Lists */
      .q-list {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .q-row {
        flex: 1 1 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1vw;
        padding: 0 0.6vw;
        border-top: 1px solid rgba(18, 24, 58, 0.09);
        min-height: 0;
      }
      .q.dark .q-row {
        border-top-color: rgba(255, 255, 255, 0.09);
      }
      .q-row:first-child {
        border-top: none;
      }
      .q-row-empty {
        justify-content: center;
        opacity: 0.25;
        font-size: 4vh;
        font-weight: 800;
      }
      .q-where {
        font-size: 1.9vh;
        font-weight: 600;
        opacity: 0.65;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .q-code {
        font-size: 4.6vh;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }
      /* Ready numbers carry the accent — they're the ones to act on. */
      .q-code-ready {
        color: #12873f;
      }
      .q.dark .q-code-ready {
        color: #4ade80;
      }
      .q-note {
        margin: 0 0 1.2vh;
        text-align: center;
        font-size: 1.9vh;
        font-weight: 600;
        opacity: 0.7;
        padding: 0 1vw;
      }
      .q-board-logo {
        margin-top: 1vh;
        max-height: 5vh;
        max-width: 70%;
        object-fit: contain;
      }

      @media (prefers-reduced-motion: reduce) {
        .q-now.has {
          animation: none;
        }
      }
      /* Portrait (a tablet on a wall): stack advert over the board. */
      @media (max-aspect-ratio: 1/1) {
        .q.mode-split {
          grid-template-columns: 1fr;
          grid-template-rows: 1fr 1.3fr;
        }
      }
    `}</style>
  );
}
