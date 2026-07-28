// In-memory brute-force throttle, shared by every endpoint that checks a
// credential (login password, staff PIN, manager approval code).
//
// The app runs as a single instance with a JSON store, so a per-process map is
// enough: it slows guessing without a database or external cache, and restarts
// simply forget — acceptable, because a restart also drops any guessing session.
//
// Keys are (endpoint, address, account) — never the address alone. Every till
// in the shop sits behind one NAT address, so an IP-only lock would take the
// whole store offline because one cashier fumbled a PIN. Per-account keying
// still throttles guessing at any single credential, which is what the control
// is for. The endpoint prefix keeps a login lock-out from bleeding into the
// PIN counter and vice versa.

const WINDOW_MS = 15 * 60 * 1000; // rolling window
const MAX_FAILS = 10; // wrong tries before lock-out
const attempts = new Map<string, { count: number; first: number }>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** One bucket per (endpoint, address, account). */
export function throttleKey(endpoint: string, ip: string, account: unknown): string {
  return `${endpoint}|${ip}|${String(account ?? "").trim().toLowerCase()}`;
}

export function lockedOut(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(key); // window elapsed — forget it
    return false;
  }
  return rec.count >= MAX_FAILS;
}

export function recordFail(key: string): void {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

/** A correct credential clears the counter — only STREAKS of failures lock. */
export function clearFails(key: string): void {
  attempts.delete(key);
}
