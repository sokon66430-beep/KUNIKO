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
          <span className="q-kh">កំពុងហៅ</span>
          <span className="q-en">NOW SERVING</span>
        </h2>
        <div className="q-now-wrap">
          <span className={`q-now ${nowServing ? "has" : ""}`}>{nowServing ? show(nowServing.code) : "—"}</span>
        </div>
        {board?.boardNote ? <p className="q-note">{board.boardNote}</p> : null}
        <div className="q-foot">
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
      </section>

      <section className="q-col">
        <h2 className="q-h">
          <span className="q-kh">កំពុងរៀបចំ</span>
          <span className="q-en">PREPARING</span>
        </h2>
        <ul className="q-list">
          {preparing.map((e) => (
            <li key={e.id} className="q-row">
              <span className="q-where">{e.where}</span>
              <span className="q-code">{show(e.code)}</span>
            </li>
          ))}
          {preparing.length === 0 && <li className="q-row q-row-empty">—</li>}
        </ul>
      </section>

      <section className="q-col q-col-ready">
        <h2 className="q-h">
          <span className="q-kh">រួចរាល់</span>
          <span className="q-en">ORDER READY</span>
        </h2>
        <ul className="q-list">
          {alsoReady.map((e) => (
            <li key={e.id} className="q-row">
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
        animation: q-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3);
      }
      .q-foot {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4vh;
      }
      .q-time {
        font-size: 2.4vh;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .q-date {
        font-size: 1.8vh;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
      }
      .q-brand {
        margin-top: 0.8vh;
        display: flex;
        align-items: center;
        gap: 0.5vw;
        font-size: 1.7vh;
        font-weight: 700;
        opacity: 0.75;
      }
      .q-dot {
        width: 0.9vh;
        height: 0.9vh;
        border-radius: 999px;
        background: #22c55e;
      }
      .q-dot.off {
        background: #f59e0b;
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

      @keyframes q-pop {
        from {
          transform: scale(0.9);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
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
