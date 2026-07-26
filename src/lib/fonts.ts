// ---------------------------------------------------------------------------
// Typography constants.
//
// The Khmer stack was copied into five screens (price labels, promo stickers,
// the customer second screen, its settings preview, and the queue TV) and had
// already drifted — some led with Kantumruy Pro, others with Battambang, so the
// same Khmer product name rendered in two different faces depending on whether
// it was on a shelf label or the TV. One constant now, read everywhere.
//
// The real declaration is the --font-khmer custom property in globals.css; this
// mirrors it for inline styles (canvas/print code can't read a CSS variable
// through the style attribute in every browser we target).
// ---------------------------------------------------------------------------

/** Niradei first, then the packaged fallbacks, then whatever the device has. */
export const KHMER_FONT =
  `'Niradei','Kantumruy Pro','Battambang','Khmer UI','Noto Sans Khmer','Leelawadee UI',sans-serif`;

/** Latin + Khmer together, for surfaces that mix the two in one run of text. */
export const MIXED_FONT = `'Plus Jakarta Sans Variable',${KHMER_FONT}`;
