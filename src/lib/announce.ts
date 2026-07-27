// ---------------------------------------------------------------------------
// Calling a pickup number out loud.
//
// The number on the board is for people looking at it. This is for everyone
// else — the customer facing away, or standing outside. It runs on the TV's own
// browser speech, so there is no audio to record, host or translate, and it
// speaks whatever numbers the shop issues today without anyone preparing files.
//
// The honest limitation, worth knowing before relying on it: Khmer speech is
// not installed on every device. An Android TV box in Cambodia usually has
// English and often has Khmer; a cheap one may have neither. So this checks
// what the device actually has and falls back rather than going silent, and
// tells the caller which language it managed — the settings screen uses that to
// warn the owner instead of letting them discover it at the counter.
// ---------------------------------------------------------------------------

import { localizeQueueCode, type QueueNumberStyle } from "./khmer";

/** Voices load asynchronously in some browsers; resolve once they exist. */
export function voicesReady(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const t = setTimeout(() => resolve(window.speechSynthesis.getVoices()), timeoutMs);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t);
        resolve(window.speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}

/** Whether this device can speak the requested language at all. */
export function hasVoiceFor(lang: string, voices: SpeechSynthesisVoice[]): boolean {
  const want = lang.slice(0, 2).toLowerCase();
  return voices.some((v) => v.lang?.slice(0, 2).toLowerCase() === want);
}

/**
 * What to say for a code, in the language actually being spoken.
 *
 * Digits are read one at a time on purpose: "A zero zero one" is unambiguous
 * across a noisy room, where "A one" invites a customer holding A010 to walk up.
 */
function phrase(code: string, lang: string, style: QueueNumberStyle): string {
  const m = /^([A-Za-z]?)(\d+)$/.exec(code);
  const letter = m?.[1] || "";
  const digits = (m?.[2] || code).split("").join(" ");
  if (lang.toLowerCase().startsWith("km")) {
    // Khmer: say the letter as the shop draws it, so what is heard matches what
    // is on the screen.
    const head = style === "khmer" && letter ? localizeQueueCode(letter + "0", "khmer").slice(0, 1) : letter;
    return `លេខ ${head} ${digits} រួចរាល់`;
  }
  return `Order ${letter} ${digits}, ready for pickup`;
}

/**
 * Say a pickup number. Returns the language actually used, or null if the
 * device could not speak at all.
 *
 * Never throws: a TV that can't talk must still show the number.
 */
export async function speakQueueCode(
  code: string,
  opts: { lang?: string; style?: QueueNumberStyle; rate?: number } = {},
): Promise<string | null> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  try {
    const want = opts.lang || "en-US";
    const voices = await voicesReady();
    // Fall back to English rather than staying silent: a number called in the
    // wrong language is still a number called.
    const lang = hasVoiceFor(want, voices) ? want : hasVoiceFor("en", voices) ? "en-US" : want;
    const u = new SpeechSynthesisUtterance(phrase(code, lang, opts.style || "latin"));
    u.lang = lang;
    // Slower than default. Announcements are heard once, over noise, often by
    // someone not listening for them.
    u.rate = opts.rate ?? 0.85;
    const voice = voices.find((v) => v.lang === lang) || voices.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
    return lang;
  } catch {
    return null;
  }
}
