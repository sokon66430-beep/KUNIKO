import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { DEFAULT_ROLE_DENIED, canSwitchStores, reachesAllStores } from "@/lib/access";

export const dynamic = "force-dynamic";

// The stores a user may reach: everyone with all-store access sees them all; an
// Area Manager sees their home store plus the owner-assigned extras; everyone
// else is pinned to their home store.
function allowedStoreIds(sys: Awaited<ReturnType<typeof readSystem>>, uid: string, role: string, homeStoreId: string): Set<string> {
  if (reachesAllStores(role as any)) return new Set(sys.stores.map((st) => st.id));
  const ids = new Set<string>([homeStoreId]);
  if (role === "area_manager") {
    const me = sys.users.find((u) => u.id === uid);
    for (const id of me?.storeIds ?? []) ids.add(id);
  }
  return ids;
}

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sys = await readSystem();
  const allowed = allowedStoreIds(sys, s.uid, s.role, s.storeId);
  const stores = sys.stores
    .filter((st) => allowed.has(st.id))
    .map((st) => ({ id: st.id, name: st.name }));
  // Effective denied-page list for this role — the owner's live /permissions
  // config if set, otherwise the built-in baseline. Owner is never denied.
  const denied = s.role === "owner" ? [] : sys.rolePermissions?.[s.role] ?? DEFAULT_ROLE_DENIED[s.role] ?? [];
  return NextResponse.json({
    user: { id: s.uid, name: s.name, role: s.role, storeId: s.storeId, storeName: s.storeName },
    stores,
    denied,
  });
}

// Switch the active store (re-issues the signed session). Owner, Procurement
// and Accounting only.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canSwitchStores(s.role))
    return NextResponse.json({ error: "You can't switch stores" }, { status: 403 });

  const { storeId } = await req.json().catch(() => ({}));
  const sys = await readSystem();
  const store = sys.stores.find((st) => st.id === storeId);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  // An Area Manager may only switch to a store the owner assigned them.
  if (!allowedStoreIds(sys, s.uid, s.role, s.storeId).has(store.id)) {
    return NextResponse.json({ error: "That store isn't assigned to you" }, { status: 403 });
  }

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
