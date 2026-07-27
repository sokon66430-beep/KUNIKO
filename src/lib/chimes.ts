// ---------------------------------------------------------------------------
// The sound the customer TV makes when an order is called.
//
// Synthesised with the Web Audio API rather than shipped as audio files. That
// is a deliberate trade:
//
//  - Nothing to download. A TV on shop wifi plays the chime the instant the
//    number changes, and a slow connection can't make the bell arrive after the
//    number it was announcing.
//  - Nothing to licence. Every "notification sound" pack carries terms, and a
//    shop playing one on a public screen all day is exactly the use those terms
//    restrict. A sine wave belongs to nobody.
//  - Nothing in the store document. Sound files are big, and this store file is
//    re-serialised on EVERY sale — a 200 KB chime would be paid for again on
//    every transaction, for ever.
//
// Each chime is a short list of notes. Kept plain on purpose: these have to be
// audible over a fryer and a room of people, so they are clean tones with a
// fast attack, not textured sounds that turn to mush on a TV speaker.
// ---------------------------------------------------------------------------

export type ChimeId = "none" | "ding" | "dingdong" | "chime" | "bell" | "soft" | "alert" | "arcade";

type Note = {
  hz: number;
  at: number; // seconds from the start of the chime
  len: number; // how long it rings
  type?: OscillatorType;
  gain?: number; // relative loudness of this note within the chime
};

/**
 * The chimes the owner can pick from, in the order they're offered.
 *
 * Named for what they sound like, not what they're for — someone choosing one
 * is listening, not reading.
 */
export const CHIMES: { id: ChimeId; name: string; hint: string; notes: Note[] }[] = [
  { id: "none", name: "No sound", hint: "Silent — numbers change with no chime", notes: [] },
  {
    id: "ding",
    name: "Ding",
    hint: "One clear bell. The safe choice",
    notes: [{ hz: 880, at: 0, len: 0.7 }],
  },
  {
    id: "dingdong",
    name: "Ding-dong",
    hint: "Two tones, like a shop door",
    notes: [
      { hz: 784, at: 0, len: 0.45 },
      { hz: 587, at: 0.22, len: 0.75 },
    ],
  },
  {
    id: "chime",
    name: "Chime",
    hint: "Three rising notes. Gentle, hard to miss",
    notes: [
      { hz: 659, at: 0, len: 0.35 },
      { hz: 784, at: 0.16, len: 0.35 },
      { hz: 1047, at: 0.32, len: 0.85 },
    ],
  },
  {
    id: "bell",
    name: "Bell",
    hint: "Bright counter bell with a long ring",
    notes: [
      { hz: 1319, at: 0, len: 1.2 },
      { hz: 2637, at: 0, len: 0.6, gain: 0.35 }, // the overtone that makes it read as metal
    ],
  },
  {
    id: "soft",
    name: "Soft beep",
    hint: "Quiet and low. For a small room",
    notes: [{ hz: 523, at: 0, len: 0.5, type: "triangle" }],
  },
  {
    id: "alert",
    name: "Alert",
    hint: "Two sharp beeps. Cuts through a busy shop",
    notes: [
      { hz: 988, at: 0, len: 0.18, type: "square", gain: 0.5 },
      { hz: 988, at: 0.24, len: 0.18, type: "square", gain: 0.5 },
    ],
  },
  {
    id: "arcade",
    name: "Cheerful",
    hint: "Four quick notes. Friendly, for a café",
    notes: [
      { hz: 523, at: 0, len: 0.14, type: "square", gain: 0.35 },
      { hz: 659, at: 0.1, len: 0.14, type: "square", gain: 0.35 },
      { hz: 784, at: 0.2, len: 0.14, type: "square", gain: 0.35 },
      { hz: 1047, at: 0.3, len: 0.5, type: "square", gain: 0.35 },
    ],
  },
];

export const DEFAULT_CHIME: ChimeId = "ding";

/** The ids the server will accept — anything else is not a chime we can play. */
export const CHIME_IDS: string[] = CHIMES.map((c) => c.id);

export function chimeName(id: string | undefined): string {
  return CHIMES.find((c) => c.id === id)?.name ?? "Ding";
}

// One AudioContext for the page. Browsers cap how many a tab may create, and a
// TV left running for a week would otherwise open one per call.
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/**
 * Whether the browser will actually let us make a noise yet.
 *
 * Browsers refuse to play audio until someone has interacted with the page.
 * A TV is opened once and then never touched, so without checking this a shop
 * would set a chime, hear nothing, and conclude the feature is broken. The
 * display uses this to show a one-time "tap to turn on sound" prompt.
 */
export function audioBlocked(): boolean {
  const a = audio();
  return !!a && a.state === "suspended";
}

/** Called from a real tap/click, which is the only thing that lifts the block. */
export async function unlockAudio(): Promise<boolean> {
  const a = audio();
  if (!a) return false;
  try {
    if (a.state === "suspended") await a.resume();
    return a.state === "running";
  } catch {
    return false;
  }
}

/**
 * Play a chime. Never throws and never blocks — a silent TV is a small problem,
 * a TV stuck on an error is a big one.
 *
 * `volume` is 0–100 as the owner sets it on the settings screen.
 */
export function playChime(id: string | undefined, volume = 80): void {
  const chime = CHIMES.find((c) => c.id === id);
  if (!chime || chime.notes.length === 0) return;
  const a = audio();
  if (!a || a.state === "suspended") return;

  try {
    const t0 = a.currentTime + 0.02;
    // Squared so the slider behaves the way an ear expects: half-way sounds
    // half as loud, not barely quieter.
    const master = Math.pow(Math.min(100, Math.max(0, volume)) / 100, 2) * 0.6;

    for (const n of chime.notes) {
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = n.type || "sine";
      osc.frequency.value = n.hz;

      const start = t0 + n.at;
      const peak = master * (n.gain ?? 1);
      // A fast attack and an exponential decay is what makes a tone read as a
      // struck bell rather than a test tone. Ramping to a tiny value rather
      // than 0 because exponential ramps can't reach zero.
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.len);

      osc.connect(g);
      g.connect(a.destination);
      osc.start(start);
      osc.stop(start + n.len + 0.05);
    }
  } catch {
    /* a screen that can't make a noise still shows the number */
  }
}
