import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readDB, mutateDB } from "@/lib/db";
import { heldElsewhere, takeTill } from "@/lib/tillHolders";
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

  const { employeeId, pin, posTerminalId } = await req.json().catch(() => ({}));
  if (!employeeId || !pin) return NextResponse.json({ error: "Pick your name and enter your PIN" }, { status: 400 });
  const terminal = typeof posTerminalId === "string" ? posTerminalId.trim() : "";

  const db = await readDB(); // current store (from the session)
  const emp = db.scheduleEmployees.find((e) => e.id === employeeId && e.active !== false);
  if (!emp || !emp.pinHash || !verifyPassword(String(pin), emp.pinHash)) {
    return NextResponse.json({ error: "Wrong PIN, or this staff can't sign in." }, { status: 401 });
  }

  // One person, one till. Checked AFTER the PIN so a wrong PIN can't be used to
  // find out where somebody is working.
  if (terminal) {
    const elsewhere = heldElsewhere(db, emp.id, terminal);
    if (elsewhere) {
      return NextResponse.json(
        {
          error: `${emp.name} is already signed in on ${elsewhere.posTerminalId}. Sign out there first, or have someone else take that till.`,
        },
        { status: 409 },
      );
    }
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

  // Take the till. Also releases whoever held it before — which is how a hold
  // is normally cleared, since staff hand over rather than sign out.
  if (terminal) {
    await mutateDB((db) => {
      takeTill(db, terminal, { id: emp.id, name: emp.name });
      return true;
    });
  }

  return NextResponse.json({ user: { name: emp.name, role: "store_crew", storeId: s.storeId, storeName: s.storeName } });
}
