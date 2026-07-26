import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-memory brute-force throttle. The app runs as a single instance with a JSON
// store, so a per-process map is enough: it slows password guessing without a
// database or external cache. Cleared on a successful login.
//
// Keyed by IP **+ username**, deliberately. Keying on IP alone locks the whole
// SHOP out: every terminal sits behind one NAT address, so a cashier fumbling
// their own password ten times would take the owner offline with them, mid-
// trade, for fifteen minutes. Per-account keying still throttles guessing at
// any single login (which is what the control is actually for) while leaving
// everyone else able to sign in.
const WINDOW_MS = 15 * 60 * 1000; // rolling window
const MAX_FAILS = 10; // wrong tries before lock-out
const attempts = new Map<string, { count: number; first: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// One bucket per (address, account) pair.
function attemptKey(ip: string, username: unknown): string {
  return `${ip}|${String(username ?? "").trim().toLowerCase()}`;
}

function lockedOut(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(key); // window elapsed — forget it
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(key: string): void {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  // The body is read BEFORE the lock-out check so the counter can be keyed to
  // the account being tried, not just the address it came from.
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  const key = attemptKey(ip, username);
  if (lockedOut(key)) {
    return NextResponse.json(
      { error: "Too many attempts for this login. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const sys = await readSystem();
  const user = sys.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    recordFail(key);
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  attempts.delete(key); // success clears the counter

  const store = sys.stores.find((s) => s.id === user.storeId);
  const token = await signSession({
    uid: user.id,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
    storeName: store?.name || "Store",
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);

  return NextResponse.json({
    user: { name: user.name, role: user.role, storeId: user.storeId, storeName: store?.name },
  });
}
