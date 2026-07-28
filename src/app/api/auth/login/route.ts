import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { clientIp, throttleKey, lockedOut, recordFail, clearFails } from "@/lib/throttle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  // The body is read BEFORE the lock-out check so the counter can be keyed to
  // the account being tried, not just the address it came from.
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  const key = throttleKey("login", ip, username);
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
  clearFails(key); // success clears the counter

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
