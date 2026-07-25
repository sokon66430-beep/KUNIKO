// Customer-facing display bus.
//
// The Sunmi T3 has two screens driven by ONE browser: the cashier rings up on
// the main screen (/pos), the customer watches /customer-display on the second.
// Both are the same origin in the same browser, so we sync them locally with no
// server round-trip: BroadcastChannel is the live channel, and localStorage is
// both a fallback (older webviews) and the "what's on screen right now" snapshot
// so the customer page shows the correct state the instant it opens mid-sale.
//
// Everything here is display-only. No money moves on this channel — the real
// sale is still committed by /pos against the server.

export type CDLine = {
  name: string;
  qty: number;
  lineTotal: number; // USD
  unitLabel?: string; // e.g. "Case", when not the base unit
};

export type CDState =
  | { kind: "idle"; storeName: string }
  | {
      kind: "sale";
      storeName: string;
      lines: CDLine[];
      total: number; // USD, VAT included
      discount: number; // USD
      itemCount: number;
    }
  | { kind: "khqr"; storeName: string; amount: number; qrImage: string }
  | {
      kind: "thanks";
      storeName: string;
      total: number;
      paid?: number; // USD tendered (cash)
      change?: number; // USD change due (cash)
      method: string;
    };

const CHANNEL = "stookii-customer-display";
const STORAGE_KEY = "stookii-cd-state";

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    channel = null; // BroadcastChannel unsupported — the storage mirror still works
  }
  return channel;
}

/** Push the current customer-facing state to the second screen. Safe to call often. */
export function publishCustomerDisplay(state: CDState): void {
  if (typeof window === "undefined") return;
  const msg = JSON.stringify({ state, at: Date.now() });
  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* ignore — storage mirror below still delivers */
  }
  try {
    // Writing the same string twice won't fire a storage event, so stamp it.
    window.localStorage.setItem(STORAGE_KEY, msg);
  } catch {
    /* private mode / quota — live channel still works */
  }
}

/** Read whatever is currently on the customer screen (for a freshly-opened display). */
export function readCustomerDisplay(): CDState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw).state as CDState) ?? null;
  } catch {
    return null;
  }
}

/** Listen for customer-display updates. Returns an unsubscribe function. */
export function subscribeCustomerDisplay(cb: (state: CDState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let lastAt = 0; // the timestamp of the last message we delivered, to de-dupe
  const handle = (raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (typeof msg.at === "number") {
        if (msg.at <= lastAt) return; // already delivered (poll vs event race)
        lastAt = msg.at;
      }
      const state = msg.state as CDState;
      if (state) cb(state);
    } catch {
      /* malformed — ignore */
    }
  };
  const ch = getChannel();
  const onMsg = (e: MessageEvent) => handle(String(e.data));
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) handle(e.newValue);
  };
  ch?.addEventListener("message", onMsg);
  window.addEventListener("storage", onStorage);
  // Poll fallback: on the Sunmi T3 the customer screen is a SEPARATE WebView, and
  // `storage`/BroadcastChannel events don't reliably cross WebView instances — but
  // both WebViews share the same localStorage. Re-reading it a few times a second
  // guarantees the customer screen tracks the till even when no event fires.
  const poll = window.setInterval(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) handle(raw);
    } catch {
      /* ignore */
    }
  }, 350);
  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
    window.clearInterval(poll);
  };
}
