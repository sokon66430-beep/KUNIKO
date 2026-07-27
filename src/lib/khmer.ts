// ---------------------------------------------------------------------------
// Khmer pickup numbers.
//
// The stored code never changes: a ticket is "A001" in the database, on every
// report and in every search, whatever the shop shows its customers. This file
// only decides how that code is DRAWN. Keeping the canonical form Latin means a
// receipt reprinted next year still matches its sale, and an owner searching
// "A012" finds it however the board was set at the time.
//
// Three styles, because a Cambodian shop legitimately wants any of them:
//   latin  A001   — as today
//   mixed  A០០១   — Latin letter, Khmer digits. Common on real shop boards,
//                   because the letter is a block marker rather than a word
//   khmer  ក០០១   — fully Khmer
// ---------------------------------------------------------------------------

export type QueueNumberStyle = "latin" | "mixed" | "khmer";

export const QUEUE_NUMBER_STYLES: { value: QueueNumberStyle; label: string; sample: string }[] = [
  { value: "latin", label: "A001 — English", sample: "A001" },
  { value: "mixed", label: "A០០១ — Khmer numbers", sample: "A០០១" },
  { value: "khmer", label: "ក០០១ — All Khmer", sample: "ក០០១" },
];

const KH_DIGITS = "០១២៣៤៥៦៧៨៩";

/** 001 → ០០១. Anything that isn't 0-9 is left exactly as it was. */
export function toKhmerDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => KH_DIGITS[Number(d)]);
}

// The Khmer consonants, in alphabetical order. Only the first 26 are ever
// reached (the Latin block letter runs A–Z before wrapping), but the full set
// is written out because this is the alphabet, not a lookup table sized to a
// current limit.
const KH_LETTERS = [
  "ក", "ខ", "គ", "ឃ", "ង",
  "ច", "ឆ", "ជ", "ឈ", "ញ",
  "ដ", "ឋ", "ឌ", "ឍ", "ណ",
  "ត", "ថ", "ទ", "ធ", "ន",
  "ប", "ផ", "ព", "ភ", "ម",
  "យ", "រ", "ល", "វ", "ស",
  "ហ", "ឡ", "អ",
];

/** A → ក, B → ខ … by position in each alphabet. */
export function toKhmerLetter(latin: string): string {
  const i = latin.toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < KH_LETTERS.length ? KH_LETTERS[i] : latin;
}

/**
 * Draw a stored code ("A001") the way this store shows it.
 *
 * Safe on anything: a legacy ticket with no letter ("025") and an empty string
 * both come back sensibly, so a screen can call this without checking first.
 */
export function localizeQueueCode(code: string, style: QueueNumberStyle = "latin"): string {
  if (!code) return code;
  if (style === "latin") return code;
  // Split the leading block letter from the digits. A code with no letter is
  // all digits, which the digit pass below handles on its own.
  // Anything that isn't "letter + digits" (a legacy or hand-entered code) still
  // gets its digits converted, so the board never shows two scripts at once.
  const m = /^([A-Za-z]?)(\d+)$/.exec(code);
  if (!m) return toKhmerDigits(code);
  const [, letter, digits] = m;
  const head = style === "khmer" && letter ? toKhmerLetter(letter) : letter;
  return head + toKhmerDigits(digits);
}
