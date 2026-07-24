// Held (parked) orders for the till.
//
// A cashier can HOLD the current sale — customer forgot their wallet, a price
// check, a slow payment — serve the next customer, then RESUME it. Held orders
// live on THIS till device only (localStorage): they're transient, per-register,
// and never touch the server, so Hold/Resume keeps working with no internet.
//
// The cart snapshot is stored opaquely (generic `C`) so this stays decoupled
// from the POS's private CartLine shape — the POS hands us whatever it holds and
// gets the same thing back on resume.

export type HeldOrder<C = unknown> = {
  id: string;
  at: string; // ISO time it was held
  total: number; // USD snapshot, for the list
  count: number; // item count, for the list
  customerId: string;
  customerName?: string;
  discount: string;
  wantQueue: boolean;
  cart: C; // the exact cart to restore
};

const keyFor = (till: string) => `stookii_held::${till || "till"}`;

export function loadHeld<C>(till: string): HeldOrder<C>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(till));
    const list = raw ? (JSON.parse(raw) as HeldOrder<C>[]) : [];
    // Newest first.
    return Array.isArray(list) ? list.sort((a, b) => (a.at < b.at ? 1 : -1)) : [];
  } catch {
    return [];
  }
}

export function saveHeld<C>(till: string, list: HeldOrder<C>[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(till), JSON.stringify(list));
  } catch {
    /* private mode / quota — a held order simply won't persist across a restart */
  }
}
