"use client";

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { CheckCircle, Megaphone } from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The customer queue board.
//
// Built as small components so each piece of the screen owns one job: the hero
// card, the two lists, a list row, the clock. The page above wires them to the
// live queue; nothing in here fetches, so the same components render a preview
// on the settings screen without a server.
//
// Layout is a 60/40 split — the called number gets the top three-fifths because
// it is the one thing a customer crossing the room needs to read, and the two
// lists share the rest.
//
// Sizes come from the design as fixed pixels, but every one is wrapped in a
// clamp() against the viewport. A TV is not a design canvas: at 200px flat, a
// four-character code like A001 ran off a 1366×768 shop screen and lost its
// last digit, which is the one failure this board must never have.
// ---------------------------------------------------------------------------

export type QueueItem = {
  id: string; // stable across renders — this is what tells Framer an item MOVED rather than being replaced
  number: string;
  description: string;
};

// ---------------------------------------------------------------------------
// Making the motion look natural rather than mechanical.
//
// Three rules, applied to everything below:
//
//  1. NO ROUND DURATIONS THAT SHARE A FACTOR. 4s, 2s and 4s all line up every
//     four seconds, and the whole board starts pulsing as one machine. Using
//     4.3s, 5.7s, 3.1s means the loops never re-sync, so a customer watching
//     for a minute never sees the same frame twice.
//
//  2. ASYMMETRIC KEYFRAMES. Real things don't rise and fall in equal halves.
//     Floating up slowly and settling faster (times below) reads as weight;
//     an even sine reads as a metronome.
//
//  3. NO SHARP REVERSALS. Every turn is eased at both ends. A hard direction
//     change is the single thing that makes an animation look like code.
//
// The amplitudes stay small on purpose: this screen runs all day in a room
// where people are eating, so it should look alive, never busy.
// ---------------------------------------------------------------------------

/** The gentle idle float, with an uneven rise and fall. */
const FLOAT = {
  animate: { y: [0, -3.2, -4, -1.4, 0] },
  transition: {
    duration: 4.3,
    repeat: Infinity,
    ease: "easeInOut" as const,
    times: [0, 0.34, 0.5, 0.78, 1], // slow up, lingers at the top, quicker down
  },
};

/**
 * The called number.
 *
 * The old number leaves upward while the new one springs in from 110% — a
 * substitution the eye actually notices. A cross-fade in place would let a
 * customer look up and never know their number had just been called.
 */
export function NowServingCard({
  number,
  counter,
  label,
  labelKh,
  accent = "#2563EB",
}: {
  /** null when nothing has been called yet — NOT a dash. See below. */
  number: string | null;
  counter: string;
  label: string;
  labelKh?: string;
  accent?: string;
}) {
  // An em-dash set at 200px Black is a solid bar the width of the card, which
  // reads as a rendering fault rather than "nothing yet". The empty state gets
  // its own quiet treatment instead of being squeezed through the number slot.
  const empty = !number;
  return (
    <motion.section
      // The whole card pulses when the number changes. `key` on the pulse means
      // the animation re-runs per number rather than once on mount.
      key={`card-${number}`}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.01, 1] }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="relative flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-[34px] bg-white px-6 py-8 shadow-[0_1px_2px_rgba(17,24,39,0.05),0_10px_40px_rgba(17,24,39,0.07)]"
    >
      <div className="flex items-center gap-3">
        {/* The megaphone floats, and every few seconds tips as if calling out —
            a shout, not a wobble. The long still stretch is what keeps it from
            becoming wallpaper the eye stops registering. */}
        <motion.span
          style={{ color: accent }}
          className="relative flex"
          // Two loops of different, non-dividing lengths: it drifts on 4.3s and
          // leans on 7.1s, so the lean lands at a different point in the drift
          // every time. The lean itself is a slow lift and an even slower
          // return — a megaphone being raised, not a head being shaken.
          animate={{ y: [0, -3.2, -4, -1.4, 0], rotate: [0, 0, -7, -5.5, 0, 0] }}
          transition={{
            y: { duration: 4.3, repeat: Infinity, ease: "easeInOut", times: [0, 0.34, 0.5, 0.78, 1] },
            rotate: {
              duration: 7.1,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.55, 0.66, 0.74, 0.9, 1], // still, lift, hold, settle back
            },
          }}
        >
          <Megaphone strokeWidth={2} className="h-[clamp(22px,3.4vh,34px)] w-[clamp(22px,3.4vh,34px)]" />
          {/* Sound leaving the horn while it's raised. Each ring is slower and
              fainter than the one before it, the way a sound actually spreads —
              equal rings would read as a wifi symbol. */}
          {[0, 1, 2].map((i) => (
            <motion.span
              aria-hidden
              key={i}
              className="pointer-events-none absolute right-[-34%] top-1/2 h-[34%] w-[34%] rounded-full border-2"
              style={{ borderColor: "currentColor", translateY: "-50%" }}
              animate={{ opacity: [0, 0.42 - i * 0.11, 0], scale: [0.35, 1.25 + i * 0.35, 1.7 + i * 0.5] }}
              transition={{
                duration: 2 + i * 0.45,
                repeat: Infinity,
                repeatDelay: 7.1 - (2 + i * 0.45), // one burst per lean, then silence
                delay: 3.9 + i * 0.34,
                ease: "easeOut",
              }}
            />
          ))}
        </motion.span>
        <div className="text-center leading-tight">
          {labelKh && (
            <span className="block font-khmer text-[clamp(15px,2.3vh,24px)] font-bold text-[#111827]">{labelKh}</span>
          )}
          <span className="block text-[clamp(11px,1.5vh,15px)] font-bold uppercase tracking-[0.18em] text-[#6B7280]">
            {label}
          </span>
        </div>
      </div>

      {/* One number in, one number out. mode="popLayout" lets the outgoing copy
          leave without shoving the incoming one sideways mid-flight. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* A soft blob of the store colour sitting behind the number, breathing
            slowly on its own long period. It gives the number something to sit
            ON — without it the digits float in white space and the card reads
            as empty even when a number is up. */}
        {!empty && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute h-[62%] w-[62%] rounded-full blur-2xl"
            style={{ background: accent, opacity: 0.1 }}
            animate={{ scale: [1, 1.09, 1.03, 1], opacity: [0.08, 0.13, 0.1, 0.08] }}
            transition={{ duration: 6.7, repeat: Infinity, ease: "easeInOut", times: [0, 0.36, 0.7, 1] }}
          />
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={number ?? "empty"}
            initial={{ opacity: 0, scale: 1.1, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -28 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            style={{ color: empty ? "#D1D5DB" : accent }}
            className={
              empty
                ? "text-center text-[clamp(16px,2.6vh,28px)] font-bold text-[#D1D5DB]"
                : "whitespace-nowrap text-center text-[clamp(64px,min(200px,26vh,17vw),200px)] font-bold leading-[0.9] tracking-[-0.04em] tabular-nums"
            }
          >
            {empty ? "No orders yet" : number}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* The counter line lands AFTER the number, so the eye reads the number
          first and is then told where to go. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={`${number}-${counter}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="text-[clamp(14px,2.2vh,22px)] font-semibold text-[#6B7280]"
        >
          {counter}
        </motion.p>
      </AnimatePresence>
    </motion.section>
  );
}

/** One row: a big number, and a quiet line saying what it's waiting for. */
export function QueueListItem({ item, tone }: { item: QueueItem; tone: "preparing" | "ready" }) {
  return (
    <motion.li
      // `layout` is what makes the rows BELOW a removed one glide up into place
      // instead of snapping — the thing that makes the board feel considered.
      layout
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="relative flex items-center justify-between gap-4 overflow-hidden rounded-[22px] bg-[#F9FAFB] px-4 py-3"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[clamp(12px,1.8vh,18px)] font-medium text-[#6B7280]">
          {item.description}
        </span>
      </span>
      <span
        className={`shrink-0 text-[clamp(24px,min(56px,6vh,4.4vw),56px)] font-bold leading-none tracking-[-0.02em] tabular-nums ${
          tone === "ready" ? "text-[#059669]" : "text-[#111827]"
        }`}
      >
        {item.number}
      </span>
      {/* A ready number breathes gently; a preparing one doesn't. That single
          difference lets a customer tell the two columns apart from across the
          room without reading either heading. */}
      {tone === "ready" && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[22px]"
          style={{ background: "#059669" }}
          animate={{ opacity: [0, 0.03, 0.06, 0.02, 0] }}
          transition={{ duration: 5.9, repeat: Infinity, ease: "easeInOut", times: [0, 0.3, 0.5, 0.76, 1] }}
        />
      )}
    </motion.li>
  );
}

/**
 * The pot, with steam actually coming off it.
 *
 * Three wisps rather than one, on staggered delays and slightly different
 * paths, because real steam never rises as a single repeating puff — one wisp
 * on a loop reads as a blinking icon, three offset ones read as cooking.
 *
 * Drawn ABOVE the Lucide pot rather than inside it: the icon set's paths aren't
 * ours to animate, and layering keeps us on the standard icon while still
 * getting the movement.
 */
function SteamingPot({ colour }: { colour: string }) {
  // Every wisp differs in EVERY property — where it starts, how far it drifts,
  // how long it lives, how opaque it gets, which way it curls. Three copies of
  // one wisp on staggered delays still read as a repeating pattern, because the
  // eye locks onto the shape; three genuinely different ones read as steam.
  const wisps = [
    { x: -4.5, drift: -3.4, dur: 3.7, delay: 0, peak: 0.5, curl: 1 },
    { x: 0.5, drift: 1.2, dur: 4.6, delay: 1.3, peak: 0.42, curl: -1 },
    { x: 4.5, drift: 3.1, dur: 3.1, delay: 2.4, peak: 0.34, curl: 1 },
  ];
  return (
    <span className="relative flex" style={{ color: colour }}>
      {/* The pan drifts rather than rocks. A pure rotation back and forth is a
          metronome; combining a small rotation with a smaller sideways shift on
          a different period gives a wander that never quite repeats. */}
      <motion.span
        animate={{ rotate: [0, -1.2, 0.4, 1.1, 0], x: [0, 0.4, -0.3, 0] }}
        transition={{
          rotate: { duration: 5.3, repeat: Infinity, ease: "easeInOut", times: [0, 0.28, 0.55, 0.8, 1] },
          x: { duration: 3.7, repeat: Infinity, ease: "easeInOut" },
        }}
        className="flex"
      >
        {/* An OPEN pot, drawn here rather than Lucide's CookingPot, which has a
            lid across the top. A lidded pot with steam pouring out of it is a
            small lie, and at this size the lid line also crowded the rim into
            looking like a smudge. Open, the steam has somewhere to come from. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[clamp(18px,2.6vh,26px)] w-[clamp(18px,2.6vh,26px)]"
        >
          {/* rim, wider than the body so the pot reads as open from the front */}
          <path d="M3.4 10.4h17.2" />
          {/* body, tapering to the base */}
          <path d="M5.1 10.4h13.8l-1 7.6a2.5 2.5 0 0 1-2.5 2.2H8.6a2.5 2.5 0 0 1-2.5-2.2l-1-7.6Z" />
          {/* handles */}
          <path d="M3.4 11.4H2.6a1.3 1.3 0 0 1 0-2.6h.8" />
          <path d="M20.6 11.4h.8a1.3 1.3 0 0 0 0-2.6h-.8" />
        </svg>
      </motion.span>

      {/* pointer-events-none + aria-hidden: decoration only. It must never sit
          between a finger and anything, or be read out to anybody. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-[85%] flex justify-center">
        <svg viewBox="0 0 24 16" className="h-[clamp(12px,1.8vh,18px)] w-[clamp(18px,2.6vh,26px)] overflow-visible">
          {wisps.map((w, i) => (
            <motion.path
              key={i}
              d={`M${12 + w.x} 15 c ${-2.2 * w.curl} -3 ${2.2 * w.curl} -4.6 0 -7.6 c ${-1.6 * w.curl} -2.2 ${0.6 * w.curl} -3.6 ${0.6 * w.curl} -5.4`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              // Fades in fast, lives briefly, thins out slowly as it climbs and
              // spreads — steam gets fainter and wider as it goes, it doesn't
              // simply vanish at full strength.
              animate={{
                opacity: [0, w.peak, w.peak * 0.55, 0],
                y: [4, -3, -9, -15],
                x: [0, w.drift * 0.35, w.drift, w.drift * 1.7],
                scaleY: [0.65, 0.95, 1.15, 1.35],
                scaleX: [1, 1.06, 1.16, 1.3],
              }}
              transition={{
                duration: w.dur,
                repeat: Infinity,
                delay: w.delay,
                ease: "easeOut",
                times: [0, 0.22, 0.6, 1],
              }}
              style={{ transformOrigin: "bottom center" }}
            />
          ))}
        </svg>
      </span>
    </span>
  );
}

/** A titled column of rows. Empty says so in words — a blank panel reads as broken. */
export function QueueList({
  items,
  label,
  labelKh,
  tone,
  emptyText,
}: {
  items: QueueItem[];
  label: string;
  labelKh?: string;
  tone: "preparing" | "ready";
  emptyText: string;
}) {
  // Only the ready column uses a Lucide icon; the preparing one draws its own
  // open pot so the steam has an opening to rise out of (see SteamingPot).
  const colour = tone === "ready" ? "#059669" : "#EA580C";
  return (
    <section
      // A whisper of the column's own colour, top to bottom. Pure white twice
      // made the two lists look like one wide panel with a gap in it.
      style={{ background: tone === "ready" ? "linear-gradient(180deg,#F2FBF7 0%,#FFF 58%)" : "linear-gradient(180deg,#FFF8F1 0%,#FFF 58%)" }}
      className="flex min-h-0 flex-col rounded-[34px] px-4 py-4 shadow-[0_1px_2px_rgba(17,24,39,0.05),0_10px_40px_rgba(17,24,39,0.06)]"
    >
      <div className="mb-3 flex items-center justify-center gap-2.5">
        {tone === "preparing" ? (
          <SteamingPot colour={colour} />
        ) : (
          <motion.span {...FLOAT} style={{ color: colour }} className="flex">
            <CheckCircle strokeWidth={2} className="h-[clamp(18px,2.6vh,26px)] w-[clamp(18px,2.6vh,26px)]" />
          </motion.span>
        )}
        <div className="text-center leading-tight">
          {labelKh && (
            <span className="block font-khmer text-[clamp(13px,1.9vh,20px)] font-bold text-[#111827]">{labelKh}</span>
          )}
          <span className="block text-[clamp(10px,1.3vh,13px)] font-bold uppercase tracking-[0.16em] text-[#6B7280]">
            {label}
          </span>
        </div>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((it) => (
            <QueueListItem key={it.id} item={it} tone={tone} />
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <li className="grid flex-1 place-items-center rounded-[22px] border-2 border-dashed border-[#E5E7EB] px-3 text-center text-[clamp(11px,1.6vh,15px)] font-medium text-[#9CA3AF]">
            {emptyText}
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * The clock.
 *
 * Each digit fades as it changes rather than snapping. A hard tick on a big
 * screen catches the eye once a second, for ever — which is exactly the
 * attention this board needs to spend on the numbers instead.
 */
export function LiveClock({ time, date }: { time: string; date: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="flex text-[clamp(16px,2.4vh,24px)] font-bold tabular-nums text-[#111827]">
        {time.split("").map((ch, i) => (
          <AnimatePresence mode="popLayout" key={i} initial={false}>
            <motion.span
              key={ch}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        ))}
      </span>
      <span className="text-[clamp(10px,1.4vh,14px)] font-semibold tabular-nums text-[#6B7280]">{date}</span>
    </div>
  );
}

export function Footer({ storeName, live, logo }: { storeName: string; live: boolean; logo?: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="max-h-[5vh] max-w-[18vw] object-contain" />
      ) : (
        <>
          {/* The only thing on the board that says the screen is still talking
              to the till. It breathes, because a dead dot and a live one look
              identical until one of them moves. */}
          <motion.span
            animate={live ? { boxShadow: ["0 0 0 0 rgba(34,197,94,.45)", "0 0 0 8px rgba(34,197,94,0)"] } : {}}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${live ? "bg-[#22C55E]" : "bg-[#F59E0B]"}`}
          />
          <span className="text-[clamp(11px,1.5vh,15px)] font-bold tracking-wide text-[#6B7280]">{storeName}</span>
        </>
      )}
    </div>
  );
}

/**
 * The page shell: a very slow gradient drift behind everything.
 *
 * 30 seconds per cycle is long enough that nobody consciously sees it move,
 * which is the point — it stops a static screen looking like a frozen one.
 */
export function BoardShell({ children, font }: { children: ReactNode; font?: string }) {
  return (
    // `fixed inset-0` so the board owns the whole screen and can never scroll —
    // nobody is there to scroll a TV.
    //
    // Kantumruy Pro for EVERYTHING here, Latin numbers included, so "A005" and
    // "កំពុងហៅ" are cut from the same face instead of the board mixing two.
    //
    // It is why nothing on this screen is heavier than 700: Kantumruy Pro ships
    // 100–700 and no further, so asking for 800 or 900 makes the browser
    // synthesise a bolder face — which smears Khmer diacritics into the letters
    // above and below them. A real Bold beats a faked Black every time.
    <div className="fixed inset-0 overflow-hidden bg-[#EEF1F8] font-khmer" style={font ? { fontFamily: font } : undefined}>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-[30%] opacity-[0.55]"
        style={{
          background:
            "radial-gradient(38% 44% at 25% 30%, rgba(37,99,235,.14) 0%, transparent 70%), radial-gradient(34% 40% at 78% 68%, rgba(5,150,105,.11) 0%, transparent 70%), radial-gradient(30% 36% at 60% 18%, rgba(234,88,12,.09) 0%, transparent 70%)",
        }}
        // Three axes on three different periods, so the mesh wanders instead
        // of sliding back and forth along one line.
        animate={{ x: ["-2%", "1.4%", "2%", "-0.6%", "-2%"], y: ["-1.5%", "0.8%", "1.5%", "-0.4%", "-1.5%"], scale: [1, 1.04, 1.06, 1.02, 1] }}
        transition={{
          x: { duration: 31, repeat: Infinity, ease: "easeInOut" },
          y: { duration: 43, repeat: Infinity, ease: "easeInOut" },
          scale: { duration: 37, repeat: Infinity, ease: "easeInOut" },
        }}
      />
      {/* Honour the device's "reduce motion" setting for every animation in
          here at once. This is a screen people sit and look at while they wait,
          and some of them get motion sick — the numbers still update, they just
          stop flying. */}
      <MotionConfig reducedMotion="user">
        <div className="relative flex h-full flex-col">{children}</div>
      </MotionConfig>
    </div>
  );
}
