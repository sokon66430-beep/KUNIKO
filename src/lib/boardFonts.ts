// ---------------------------------------------------------------------------
// The typefaces a shop can choose for its customer board.
//
// Every one is BUNDLED with the app, not fetched from Google. A TV box on shop
// wifi must never wait on a font server to draw the number someone is queueing
// for — and half of these shops lose their internet for minutes at a time.
//
// One list, read by both the picker and the board, so the two can never offer
// and render different things.
//
// `maxWeight` matters more than it looks: several Khmer faces ship only 400.
// Asking for 700 on one of those makes the browser SYNTHESISE a bold, which
// thickens the diacritics until they merge with the letters above and below.
// The board reads this and caps itself rather than shipping a smeared board.
// ---------------------------------------------------------------------------

export type BoardFontId = "kantumruy" | "battambang" | "hanuman" | "nokora" | "koulen" | "moul";

export type BoardFont = {
  id: BoardFontId;
  name: string; // what the owner sees
  hint: string; // why they'd pick it
  stack: string; // the CSS font-family
  maxWeight: 400 | 700 | 900;
};

export const BOARD_FONTS: BoardFont[] = [
  {
    id: "kantumruy",
    name: "Kantumruy Pro",
    hint: "Clean and modern. The safe choice for a board read across a room",
    stack: `'Kantumruy Pro','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 700,
  },
  {
    id: "battambang",
    name: "Battambang",
    hint: "Sturdy and traditional. Heavier, so numbers carry further",
    stack: `'Battambang','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 900,
  },
  {
    id: "hanuman",
    name: "Hanuman",
    hint: "Softer and rounder. Friendly without being playful",
    stack: `'Hanuman','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 900,
  },
  {
    id: "nokora",
    name: "Nokora",
    hint: "Narrow. Fits more on a small screen",
    stack: `'Nokora','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 900,
  },
  {
    id: "koulen",
    name: "Koulen",
    hint: "Big display face — bold and characterful. One weight only",
    stack: `'Koulen','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 400,
  },
  {
    id: "moul",
    name: "Moul",
    hint: "Decorative and formal. Handsome, but hard work in small text",
    stack: `'Moul','Khmer UI','Noto Sans Khmer',sans-serif`,
    maxWeight: 400,
  },
];

export const DEFAULT_BOARD_FONT: BoardFontId = "kantumruy";

export function boardFont(id: string | undefined): BoardFont {
  return BOARD_FONTS.find((f) => f.id === id) || BOARD_FONTS[0];
}

export const BOARD_FONT_IDS: string[] = BOARD_FONTS.map((f) => f.id);
