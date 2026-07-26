// ---------------------------------------------------------------------------
// Real-time fan-out for the kitchen display and the customer TV.
//
// Server-Sent Events, not WebSocket. The reasons are practical:
//  - This app is a Next.js standalone server on Render. A WebSocket needs a
//    custom HTTP server or a second service; SSE is an ordinary route handler
//    returning a stream, so it deploys with everything else.
//  - EventSource reconnects BY ITSELF, with backoff, built into the browser.
//    That is Step 9's "auto reconnect" for free, and it is the part hand-rolled
//    socket code usually gets wrong.
//  - The traffic is one-way: the server tells the screens what changed. A
//    kitchen button press is a normal POST; nothing needs a duplex channel.
//  - It works in an Android TV browser, a tablet and a mini PC with no client
//    library at all.
//
// Subscribers are held per store, so one store's kitchen never sees another's
// orders. State lives in this process: the service runs a single instance, and
// a screen that misses an event during a restart re-syncs on reconnect because
// it refetches the full list on open (see the KDS/TV clients).
// ---------------------------------------------------------------------------

export type QueueEventName = "queue:changed";

type Subscriber = (event: QueueEventName, payload: unknown) => void;

// Kept on globalThis so Next.js hot-reload (and repeated module evaluation)
// doesn't strand a second, empty registry while screens hold the first.
const g = globalThis as unknown as { _stookiiBus?: Map<string, Set<Subscriber>> };
const channels: Map<string, Set<Subscriber>> = (g._stookiiBus ||= new Map());

export function subscribe(storeId: string, fn: Subscriber): () => void {
  let set = channels.get(storeId);
  if (!set) channels.set(storeId, (set = new Set()));
  set.add(fn);
  return () => {
    const s = channels.get(storeId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) channels.delete(storeId); // don't leak an empty set per store
  };
}

/**
 * Tell every screen watching this store that the queue moved.
 *
 * Deliberately fire-and-forget and never throws: publishing is a side effect of
 * taking a payment or pressing READY, and a broken display must never be able
 * to fail the transaction that triggered it.
 */
export function publish(storeId: string, event: QueueEventName = "queue:changed", payload: unknown = {}): void {
  const set = channels.get(storeId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event, payload);
    } catch {
      /* a dead subscriber is dropped by its own stream's cancel handler */
    }
  }
}

export function subscriberCount(storeId: string): number {
  return channels.get(storeId)?.size ?? 0;
}
