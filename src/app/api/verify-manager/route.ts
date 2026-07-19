import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { canCancelInvoice, isCrossStoreRole } from "@/lib/access";

export const dynamic = "force-dynamic";

// Verify a manager CODE alone (no username) — the same set of people who can
// approve a cancellation (store manager / assistant store manager / owner) for
// this store. Used to gate device-level actions like entering/leaving Till Mode.
// The system finds which manager the code belongs to; it is never echoed back.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || body.managerCode || "");
  if (!code) return NextResponse.json({ error: "A manager code is required" }, { status: 400 });

  const sys = await readSystem();
  const approvers = sys.users.filter(
    (u) =>
      canCancelInvoice(u.role) &&
      (isCrossStoreRole(u.role) || u.storeId === session.storeId || (u.storeIds || []).includes(session.storeId)),
  );
  const mgr = approvers.find((u) => verifyPassword(code, u.passwordHash));
  if (!mgr) {
    return NextResponse.json(
      { error: "Manager code not recognised — only a store manager or assistant store manager can approve." },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, name: mgr.name });
}
