import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Staff PIN sign-in at the till. A manager first opens the store on the device
// (normal username/password → Till Mode); after that, crew hand the till over to
// each other by picking their name and typing their PIN. The swap is authorised
// by the CURRENT session (so the store is already established and trusted) and
// re-issues the cookie as that staff member with till-only (Store Crew) access.

export async function POST(req: Request) {
  const s = await getSession();
  // Must already be signed in on this device (a manager opened the store). This
  // is what establishes which store's roster the PIN is checked against.
  if (!s) return NextResponse.json({ error: "This till isn't opened yet — a manager must sign in first." }, { status: 401 });

  const { employeeId, pin } = await req.json().catch(() => ({}));
  if (!employeeId || !pin) return NextResponse.json({ error: "Pick your name and enter your PIN" }, { status: 400 });

  const db = await readDB(); // current store (from the session)
  const emp = db.scheduleEmployees.find((e) => e.id === employeeId && e.active !== false);
  if (!emp || !emp.pinHash || !verifyPassword(String(pin), emp.pinHash)) {
    return NextResponse.json({ error: "Wrong PIN, or this staff can't sign in." }, { status: 401 });
  }

  // Become that staff — till-only (Store Crew), same store as the device.
  const token = await signSession({
    uid: emp.id,
    name: emp.name,
    role: "store_crew",
    storeId: s.storeId,
    storeName: s.storeName,
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);

  return NextResponse.json({ user: { name: emp.name, role: "store_crew", storeId: s.storeId, storeName: s.storeName } });
}
