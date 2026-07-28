export const EXCHANGE_RATE = 4100; // KHR per 1 USD (display only)
export const VAT_RATE = 0.1; // 10% VAT

/**
 * Gross-profit % the ON Mart way: the sell `price` is VAT-inclusive, so profit
 * is measured against the ex-VAT (net) price. Matches the master's "GP (%)"
 * column exactly, e.g. cost 0.90 / price 1.40 → 29.29% (not the 35.71% you'd
 * get by ignoring the embedded VAT).
 */
export function gpPercent(cost: number, price: number, vatRate = VAT_RATE): number {
  const net = (price || 0) / (1 + vatRate); // strip embedded VAT from the price
  if (net <= 0) return 0;
  return ((net - (cost || 0)) / net) * 100;
}

export function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

/**
 * Riel price as it goes on a printed shelf label — a business rule, not a
 * display choice: USD × 4,100, then ALWAYS rounded UP to the next 100 riel
 * (nobody hands over 9 riel). e.g. $1.49 → 6,109៛ → 6,200៛.
 * Shared so a promotion sticker can never round differently from the shelf
 * label sitting next to it.
 */
export function rielShelfPrice(usdAmount: number, rate = EXCHANGE_RATE): number {
  const raw = (usdAmount || 0) * rate;
  return Math.ceil(Math.round(raw) / 100) * 100;
}

/**
 * Riel for amounts that are NOT a shelf price — change handed back, revenue
 * figures, informational sub-lines. Rounds to the NEAREST riel.
 *
 * Deliberately not the round-up rule: rounding up is a pricing rule that favours
 * the store on money coming IN, so applying it to money going OUT inverts it.
 * Change of $0.53 is 2,173៛; rounded up the cashier hands back 2,200៛ and the
 * drawer quietly runs ~27៛ short on every cash sale. Use rielShelfPrice() for
 * anything the customer PAYS, and this for anything they RECEIVE.
 */
export function riel(usdAmount: number, rate = EXCHANGE_RATE): string {
  return `៛${new Intl.NumberFormat("en-US").format(Math.round((usdAmount || 0) * rate))}`;
}

/**
 * Riel for an amount the customer PAYS (a total, an amount due) — formatted with
 * the same round-up-to-100 rule the printed receipt and shelf labels use, so the
 * figure on screen and the figure on paper can never disagree.
 */
export function rielDue(usdAmount: number, rate = EXCHANGE_RATE): string {
  return `៛${new Intl.NumberFormat("en-US").format(rielShelfPrice(usdAmount, rate))}`;
}

export function num(n: number): string {
  return new Intl.NumberFormat("en-US").format(n || 0);
}

export function pct(n: number): string {
  return `${(n || 0).toFixed(1)}%`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The date printed on a commercial invoice: "28 Jul 2026, 08:25 AM".
//
// Short enough to sit on ONE line of the slip. Spelling out the weekday and the
// month wrapped onto a second line and pushed the rest of the header down for no
// gain — nobody checks a receipt by its day of the week. The year stays: it is a
// tax document that may be read a long time from now.
export function invoiceDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${day}, ${time}`;
}

export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
