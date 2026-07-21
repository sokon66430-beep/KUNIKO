// Item ID generation.
//
// An Item ID is always exactly 8 digits and unique within a store. It is built as:
//
//   [ 2 digits of the sub-group code ] [ the category code ] [ a running number ]
//
// The running number fills whatever space is left so the total is 8 digits:
//   • category code 2 digits →  2 + 2 + 4  = 8   (e.g. 33 + 21 + 0001)
//   • category code 3 digits →  2 + 3 + 3  = 8   (e.g. 33 + 118 + 001)
//
// The running number is the next unused value for that prefix, so IDs sharing a
// sub-group + category stay grouped and never collide.

const onlyDigits = (s: string | undefined | null) => String(s ?? "").replace(/\D/g, "");

export function itemIdPrefix(subGroupCode?: string, catCode?: string): string {
  const sub = onlyDigits(subGroupCode).slice(0, 2);
  const cat = onlyDigits(catCode).slice(0, 3);
  let prefix = sub + cat;
  // Always leave room for at least a 2-digit running number.
  if (prefix.length > 6) prefix = prefix.slice(0, 6);
  return prefix;
}

export function generateItemId(
  subGroupCode: string | undefined,
  catCode: string | undefined,
  existing: Iterable<string>,
): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  let prefix = itemIdPrefix(subGroupCode, catCode);
  let seqLen = 8 - prefix.length; // 2..8

  // Highest running number already used under this prefix.
  let max = 0;
  for (const s of taken) {
    if (s.length === 8 && s.startsWith(prefix)) {
      const tail = Number(s.slice(prefix.length));
      if (Number.isFinite(tail) && tail > max) max = tail;
    }
  }

  // Next unused, 8 digits, guaranteed unique.
  for (let n = max + 1; n < max + 1_000_000; n++) {
    const candidate = prefix + String(n).padStart(seqLen, "0");
    if (candidate.length === 8 && !taken.has(candidate)) return candidate;
    // Sequence overflowed its reserved width — steal a digit from the prefix
    // so there's room, then restart the search from scratch.
    if (candidate.length > 8 && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
      seqLen = 8 - prefix.length;
      n = 0;
      max = 0;
    }
  }

  // Absolute fallback (should never happen): first free plain 8-digit number.
  for (let n = 1; n <= 99_999_999; n++) {
    const c = String(n).padStart(8, "0");
    if (!taken.has(c)) return c;
  }
  return "00000000";
}

// The first 4 digits a packaging code inherits from its base product — the
// sub-group + category part, so a Pack and a Case sit in the same family as the
// single they're made of.
export function packagingPrefix(baseSku: string | undefined): string {
  return onlyDigits(baseSku).slice(0, 4).padEnd(4, "0");
}

/**
 * A packaging level's own 8-digit product code.
 *
 * The first 4 digits are taken straight from the base product's code (its
 * sub-group + category), and the last 4 are a system-generated running number
 * that's unique across every code already in use — the base products' Item IDs
 * AND every other packaging code. So a "Pack of 6" reads as the same family as
 * the single it holds, but scans and reports as its own item.
 */
export function packagingItemId(baseSku: string | undefined, existing: Iterable<string>): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  const prefix = packagingPrefix(baseSku);

  // Highest 4-digit tail already used under this family, so codes stay grouped
  // and never collide.
  let max = 0;
  for (const s of taken) {
    if (s.length === 8 && s.startsWith(prefix)) {
      const tail = Number(s.slice(4));
      if (Number.isFinite(tail) && tail > max) max = tail;
    }
  }

  for (let n = max + 1; n <= 9999; n++) {
    const candidate = prefix + String(n).padStart(4, "0");
    if (!taken.has(candidate)) return candidate;
  }
  // The family's 9999 tails are somehow all used — fall back to the first free
  // 8-digit number anywhere, so a code still comes back rather than a clash.
  for (let n = 1; n <= 99_999_999; n++) {
    const c = String(n).padStart(8, "0");
    if (!taken.has(c)) return c;
  }
  return "00000000";
}
