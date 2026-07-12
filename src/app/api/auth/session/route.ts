import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { DEFAULT_ROLE_DENIED } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sys = await readSystem();
  // Owners can switch between all stores; others are pinned to their store.
  const stores =
    s.role === "owner"
      ? sys.stores.map((st) => ({ id: st.id, name: st.name }))
      : sys.stores.filter((st) => st.id === s.storeId).map((st) => ({ id: st.id, name: st.name }));
  // Effective denied-page list for this role — the owner's live /permissions
  // config if set, otherwise the built-in baseline. Owner is never denied.
  const denied = s.role === "owner" ? [] : sys.rolePermissions?.[s.role] ?? DEFAULT_ROLE_DENIED[s.role] ?? [];
  return NextResponse.json({
    user: { id: s.uid, name: s.name, role: s.role, storeId: s.storeId, storeName: s.storeName },
    stores,
    denied,
  });
}

// Owner: switch the active store (re-issues the signed session).
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (s.role !== "owner") return NextResponse.json({ error: "Only owners can switch stores" }, { status: 403 });

  const { storeId } = await req.json().catch(() => ({}));
  const sys = await readSystem();
  const store = sys.stores.find((st) => st.id === storeId);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const token = await signSession({
    uid: s.uid,
    name: s.name,
    role: s.role,
    storeId: store.id,
    storeName: store.name,
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);
  return NextResponse.json({ storeId: store.id, storeName: store.name });
}
