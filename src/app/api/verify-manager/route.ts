import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findManagerByCode } from "@/lib/managerAuth";

export const dynamic = "force-dynamic";

// Verify a code alone (no username), and return whose it is. Used to gate
// device-level actions like entering/leaving Till Mode. The code is checked
// against the appropriate set of people and is never echoed back.
//   • default    → anyone who can approve a cancellation (store manager /
//                  assistant store manager / owner) for this store.
//   • ownerOnly  → the OWNER only (Till Mode is owner-controlled).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || body.managerCode || "");
  const ownerOnly = !!body.ownerOnly;
  if (!code) return NextResponse.json({ error: "A code is required" }, { status: 400 });

  const mgr = await findManagerByCode(code, { ownerOnly, storeId: session.storeId });
  if (!mgr) {
    return NextResponse.json(
      {
        error: ownerOnly
          ? "Owner password not recognised — only the owner can switch Till Mode."
          : "Manager code not recognised — only a store manager or assistant store manager can approve.",
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, name: mgr.name });
}
