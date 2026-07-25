import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { DEFAULT_ROLE_DENIED, canSwitchStores, reachesAllStores } from "@/lib/access";
import { startBackupScheduler } from "@/lib/backupScheduler";

export const dynamic = "force-dynamic";

// Start the automatic daily backup on the first request after a boot. This lives
// on a normal (Node runtime) API route the app calls constantly, rather than the
// instrumentation hook — that hook is also evaluated for the Edge runtime, where
// pulling in the backup/storage code fails the build ("Can't resolve 'fs'").
// startBackupScheduler() is idempotent, so calling it on every request is safe.
startBackupScheduler();

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
  // Use the user's CURRENT role from the store, not the one baked into the
  // session cookie at login — so an owner promoting someone (e.g. to Area
  // Manager) or assigning extra stores takes effect on their next page load,
  // without them having to sign out and back in.
  const dbUser = sys.users.find((u) => u.id === s.uid);
  const role = dbUser?.role ?? s.role;
  const allowed = allowedStoreIds(sys, s.uid, role, s.storeId);
  const stores = sys.stores
    .filter((st) => allowed.has(st.id))
    .map((st) => ({ id: st.id, name: st.name }));
  // Effective denied-page list for this role — the owner's live /permissions
  // config if set, otherwise the built-in baseline. Owner is never denied.
  const denied = role === "owner" ? [] : sys.rolePermissions?.[role] ?? DEFAULT_ROLE_DENIED[role] ?? [];
  // Capabilities (profit/cost) for this role, so a screen can hide a figure it
  // isn't allowed to show. The server strips the numbers regardless — this only
  // stops an empty card being drawn around data that never arrived.
  const caps = sys.roleCaps?.[role] ?? {};
  return NextResponse.json({
    user: { id: s.uid, name: s.name, role, storeId: s.storeId, storeName: s.storeName },
    stores,
    denied,
    caps,
  });
}

// Switch the active store (re-issues the signed session). Owner, Procurement
// and Accounting only.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sys = await readSystem();
  // Read the CURRENT role from the store (not the login cookie), so a freshly
  // promoted Area Manager can switch right away — and the re-issued session
  // carries their up-to-date role.
  const dbUser = sys.users.find((u) => u.id === s.uid);
  const role = dbUser?.role ?? s.role;
  if (!canSwitchStores(role))
    return NextResponse.json({ error: "You can't switch stores" }, { status: 403 });

  const { storeId } = await req.json().catch(() => ({}));
  const store = sys.stores.find((st) => st.id === storeId);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  // An Area Manager may only switch to a store the owner assigned them.
  if (!allowedStoreIds(sys, s.uid, role, s.storeId).has(store.id)) {
    return NextResponse.json({ error: "That store isn't assigned to you" }, { status: 403 });
  }

  const token = await signSession({
    uid: s.uid,
    name: s.name,
    role,
    storeId: store.id,
    storeName: store.name,
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);
  return NextResponse.json({ storeId: store.id, storeName: store.name });
}
