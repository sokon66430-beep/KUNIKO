import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem } from "@/lib/system";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/userIdentity";

export const dynamic = "force-dynamic";

// Any signed-in user can change their OWN password.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  // Same strength policy as creating an account: 8+ chars, letters and numbers.
  const pwErr = passwordProblem(String(newPassword || ""));
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const sys = await readSystem();
  const user = sys.users.find((u) => u.id === s.uid);
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!verifyPassword(String(currentPassword || ""), user.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  await mutateSystem((sys2) => {
    const u = sys2.users.find((x) => x.id === s.uid);
    if (u) u.passwordHash = hashPassword(String(newPassword));
  });
  return NextResponse.json({ ok: true });
}
