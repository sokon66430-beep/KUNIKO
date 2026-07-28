"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playChime, audioBlocked, unlockAudio } from "@/lib/chimes";
import { localizeQueueCode, type QueueNumberStyle } from "@/lib/khmer";
import { speakQueueCode } from "@/lib/announce";
import { BoardShell, Footer, LiveClock, NowServingCard, QueueList, type QueueItem } from "@/components/queue/QueueBoard";
import { boardFont } from "@/lib/boardFonts";

// ---------------------------------------------------------------------------
// Customer queue TV.
//
// A 60/40 board: the called number holds the top three-fifths on its own,
// PREPARING and ORDER READY share the bottom two. The number is what a customer
// crossing the room needs, and giving it a whole row rather than a third of one
// is the difference between reading it from the door and walking closer.
//
// Everything visual lives in components/queue/QueueBoard. This file is the wire
// to the shop: the live feed, the chime, the voice, and which TV this is.
//
// It stays fresh from the SSE feed and never needs a refresh. EventSource
// reconnects on its own and we refetch on every reconnect, so a screen left
// running for a week is still correct.
// ---------------------------------------------------------------------------

type Entry = { id: string; code: string; at: string; where: string };
type Mode = "board" | "split" | "ads";
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
    font: string;
  } | null;
  preparing: Entry[];
  ready: Entry[];
  voice: boolean;
  voiceLang: string;
  chime: string;
  volume: number;
  numberStyle: QueueNumberStyle;
  font: string;
};

const ROWS = 4; // what fits the bottom 40% of a 16:9 screen at this row height

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
//   /queue-display                → the board (default)
//   /queue-display?mode=ads       → promotions only, for a menu screen
//   /queue-display?mode=split     → advert beside the board
//   /queue-display?voice=1        → THIS screen speaks (turn on for ONE only)
// ---------------------------------------------------------------------------
function readScreenConfig(search: string) {
  const p = new URLSearchParams(search);
  const raw = (p.get("mode") || "board").toLowerCase();
  const mode: Mode = raw === "ads" || raw === "split" ? raw : "board";
  const n = Number(p.get("rows"));
  return {
    mode,
    dark: (p.get("theme") || "light").toLowerCase() === "dark",
    // Off by default: two TVs in earshot both announcing is worse than neither.
    voice: p.get("voice") === "1" || p.get("voice") === "on",
    rows: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8) : ROWS,
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
    ? { mode: s.mode, dark: s.dark, voice: s.voice, rows: Math.min(8, Math.max(1, s.rows)) }
    : urlCfg;

  // Latin in the data, Khmer on the glass. Every number on this screen goes
  // through here, so the board can't end up half-translated.
  const style: QueueNumberStyle = (board?.numberStyle as QueueNumberStyle) || "latin";
  const show = useCallback((code: string) => localizeQueueCode(code, style), [style]);

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
              void speakQueueCode(e.code, { lang: next.voiceLang, style: next.numberStyle || "latin" });
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
  // waiting to be collected. That's what the shop's own board does, and it's why
  // "now serving" is a single number rather than a list.
  const readyAll = useMemo(
    () => [...(board?.ready ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [board?.ready],
  );
  const nowServing = readyAll[0] || null;

  // Framer keys off `id`, so these have to be the ticket's real id — a key made
  // from the index would make a removed row look like every row below it
  // changing its number, and the whole list would animate for one collection.
  const toItems = (list: Entry[], description: string): QueueItem[] =>
    list.slice(0, cfg.rows).map((e) => ({ id: e.id, number: show(e.code), description }));

  const preparing = toItems(board?.preparing ?? [], "Preparing order");
  const ready = toItems(readyAll.slice(1), "Ready for pickup");
  const accent = board?.accent || "#2563EB";
  // The screen's own typeface wins over the store default, so one TV can differ.
  const face = boardFont(board?.screen?.font ?? board?.font);

  const AdPanel = (
    <section className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] bg-white shadow-[0_1px_2px_rgba(17,24,39,0.05),0_10px_40px_rgba(17,24,39,0.06)]">
      {ads.length > 0 ? (
        ads.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
              i === ad ? "opacity-100" : "opacity-0"
            }`}
          />
        ))
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          {board?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={board.logo} alt="" className="max-h-[22vh] max-w-[60%] object-contain" />
          ) : null}
          <p className="text-[clamp(14px,2.4vh,26px)] font-extrabold text-[#6B7280]">{board?.storeName || ""}</p>
        </div>
      )}
    </section>
  );

  if (cfg.mode === "ads") {
    return (
      <BoardShell font={face.stack}>
        <div className="flex h-full flex-col p-[2vh_1.6vw]">{AdPanel}</div>
      </BoardShell>
    );
  }

  const Board = (
    // 60/40. `minmax(0,…)` on both rows is what lets the lists scroll-clip
    // instead of pushing the hero off the top of the screen when busy.
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-[1.4vh]">
      <NowServingCard
        number={nowServing ? show(nowServing.code) : null}
        counter={board?.boardNote || (nowServing ? nowServing.where : "Please wait for your number")}
        label="NOW SERVING"
        labelKh="កំពុងហៅ"
        accent={accent}
      />
      <div className="grid min-h-0 grid-cols-2 gap-[1.2vw]">
        <QueueList
          items={preparing}
          label="PREPARING"
          labelKh="កំពុងរៀបចំ"
          tone="preparing"
          emptyText="រង់ចាំការបញ្ជាទិញ · No orders"
        />
        <QueueList
          items={ready}
          label="ORDER READY"
          labelKh="រួចរាល់"
          tone="ready"
          emptyText="រង់ចាំការបញ្ជាទិញ · No orders"
        />
      </div>
    </div>
  );

  return (
    <BoardShell font={face.stack}>
      <div className="flex h-full min-h-0 flex-col gap-[1.4vh] p-[2vh_1.6vw]">
        {cfg.mode === "split" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.4fr] gap-[1.2vw]">
            {AdPanel}
            <div className="flex min-h-0 flex-col">{Board}</div>
          </div>
        ) : (
          Board
        )}

        {/* One quiet line under everything: who we are, and what time it is. */}
        <footer className="flex flex-none items-center justify-between px-1">
          <Footer storeName={board?.storeName || ""} live={live} logo={board?.boardLogo} />
          <LiveClock time={now.time} date={now.date} />
        </footer>
      </div>

      {/* Shown once, the first time this screen is set up, and never again on
          that TV. Small and in the corner: if nobody presses it the board still
          works perfectly, it is just silent. */}
      {needsTap && (
        <button
          onClick={enableSound}
          className="absolute bottom-[1.2vw] right-[1.2vw] z-20 rounded-full bg-[rgba(17,24,39,0.86)] px-[1.6vw] py-[0.9vh] text-[clamp(11px,1.5vh,15px)] font-bold text-white"
        >
          🔔 Tap once to turn on sound
        </button>
      )}
    </BoardShell>
  );
}
