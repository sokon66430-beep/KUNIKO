"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  preparing: Entry[];
  ready: Entry[];
  voice: boolean;
  voiceLang: string;
};

const ROWS = 7; // what fits a 16:9 screen at this row height, matching the existing board

// ---------------------------------------------------------------------------
// Per-screen settings, read from the URL — see /tv-displays, which builds these
// links so nobody has to type them.
//
//   /queue-display                → the three-column board (default)
//   /queue-display?mode=ads       → promotions only, for a menu/advert screen
//   /queue-display?mode=split     → advert with the queue down one side
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
  const [cfg, setCfg] = useState(() => readScreenConfig(""));
  useEffect(() => setCfg(readScreenConfig(window.location.search)), []);

  const announced = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const voiceRef = useRef(false);
  useEffect(() => {
    voiceRef.current = cfg.voice;
  }, [cfg.voice]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/queue/board", { cache: "no-store" });
      if (!r.ok) return;
      const next: Board = await r.json();
      setBoard(next);

      if (firstLoad.current) {
        // Seed silently, so opening the screen doesn't read out every number
        // already on the board.
        next.ready.forEach((e) => announced.current.add(e.code));
        firstLoad.current = false;
      } else if (next.voice && voiceRef.current && "speechSynthesis" in window) {
        for (const e of next.ready) {
          if (announced.current.has(e.code)) continue;
          announced.current.add(e.code);
          const u = new SpeechSynthesisUtterance(`Order ${e.code.split("").join(" ")}, ready for pickup`);
          u.lang = next.voiceLang;
          window.speechSynthesis.speak(u);
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
          <span className={`q-now ${nowServing ? "has" : ""}`}>{nowServing ? nowServing.code : "—"}</span>
        </div>
        <div className="q-foot">
          <span className="q-time">{now.time}</span>
          <span className="q-date">{now.date}</span>
          <span className="q-brand">
            <span className={`q-dot ${live ? "on" : "off"}`} aria-hidden />
            {board?.storeName || ""}
          </span>
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
              <span className="q-code">{e.code}</span>
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
              <span className="q-code q-code-ready">{e.code}</span>
            </li>
          ))}
          {alsoReady.length === 0 && <li className="q-row q-row-empty">—</li>}
        </ul>
      </section>
    </div>
  );

  return (
    <div className={`q ${cfg.dark ? "dark" : ""} mode-${cfg.mode}`}>
      {cfg.mode === "split" && AdPanel}
      {BoardPanel}
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
      .q {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-columns: 1fr;
        background: #eceef7;
        color: #12183a;
        /* Plus Jakarta for Latin, Kantumruy Pro for Khmer — the same pairing the
           customer second screen uses, so កំពុងហៅ / រួចរាល់ render in the store's
           typeface rather than whatever Khmer face the TV happens to ship. */
        font-family: "Plus Jakarta Sans Variable", "Kantumruy Pro", "Battambang", "Noto Sans Khmer", "Khmer UI",
          "Segoe UI", Roboto, sans-serif;
        user-select: none;
      }
      .q.dark {
        background: #0a0f1e;
        color: #e8edf9;
      }
      .q.mode-split {
        grid-template-columns: 1fr 1.35fr; /* advert, then the board */
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
        /* 700 is the heaviest Kantumruy Pro ships. Asking for 800 makes the
           browser SYNTHESISE a bolder face, which smears Khmer diacritics —
           worse than the real Bold at this size on a screen across a room. */
        font-weight: 700;
        font-family: "Kantumruy Pro", "Battambang", "Noto Sans Khmer", sans-serif;
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
        font-size: 22vh;
        font-weight: 900;
        line-height: 0.9;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: #c9cee4;
      }
      .q-now.has {
        color: #2544c7;
        animation: q-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3);
      }
      .q.dark .q-now.has {
        color: #6f8cff;
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
