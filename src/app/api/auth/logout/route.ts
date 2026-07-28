import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { mutateDB } from "@/lib/db";
import { releaseEmployee } from "@/lib/tillHolders";

export const dynamic = "force-dynamic";

export async function POST() {
  // Free whatever till this person was holding, BEFORE the cookie goes — after
  // it, there's no session left to say who they were. Without this, signing out
  // properly would be the one way to stay locked to a till, which is exactly
  // backwards. See lib/tillHolders.
  const s = await getSession();
  if (s?.uid) {
    try {
      await mutateDB((db) => {
        releaseEmployee(db, s.uid);
        return true;
      });
    } catch {
      // Never block a sign-out on this: a stuck hold expires on its own, but a
      // till that can't be signed out of is a cashier stranded mid-shift.
    }
  }
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
