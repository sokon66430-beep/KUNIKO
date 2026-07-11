import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem } from "@/lib/system";
import { hashPassword, verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

// Any signed-in user can change their OWN password.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (!newPassword || String(newPassword).length < 4) {
    return NextResponse.json({ error: "New password must be at least 4 characters" }, { status: 400 });
  }

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
