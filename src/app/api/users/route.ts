import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem, type User } from "@/lib/system";
import { hashPassword } from "@/lib/password";
import { canManageStaff, isCrossStoreRole } from "@/lib/access";
import { buildLogin, passwordProblem } from "@/lib/userIdentity";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ROLES: Role[] = [
  "owner",
  "management",
  "ops_manager",
  "area_manager",
  "store_manager",
  "asst_store_manager",
  "store_crew",
  "manager",
  "accountant",
  "procurement",
  "operations",
];

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sys = await readSystem();
  // Owner and Management (cross-store oversight) see every employee; a store user
  // sees only their own store's team.
  const seesAll = s.role === "owner" || s.role === "management";
  const visible = seesAll ? sys.users : sys.users.filter((u) => u.storeId === s.storeId);
  const list = visible.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    storeId: u.storeId,
    storeIds: u.storeIds ?? [],
    storeName: sys.stores.find((st) => st.id === u.storeId)?.name || "—",
  }));
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Only staff managers (and owners) may create accounts — same gate as editing
  // and deleting. Without this, any signed-in user, down to shop-floor crew,
  // could mint a higher-privileged account in their store and log in as it.
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "You don't have permission to add employees" }, { status: 403 });
  }
  const isOwner = s.role === "owner";
  const body = await req.json().catch(() => ({}));
  // The typed value is only the LOCAL part — the store's domain is appended below
  // to make a login like `sok@onmart-tk-592.kh`.
  const localPart = String(body.username || "").trim().toLowerCase().split("@")[0];
  const name = String(body.name || "").trim() || localPart;
  const password = String(body.password || "");
  let role: Role = ROLES.includes(body.role) ? body.role : "operations";
  // A store user may only add employees to their OWN store, and can never mint
  // an owner account (no privilege escalation). Owners may add to any store.
  let storeId = String(body.storeId || "");
  if (!isOwner) {
    storeId = s.storeId;
    // Cross-store, elevated roles (owner, management, ops/area manager) may only
    // be minted by an owner — no privilege escalation from a store account.
    if (isCrossStoreRole(role)) {
      return NextResponse.json({ error: "Only an owner can create a cross-store role" }, { status: 403 });
    }
  }

  if (!localPart || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  // Enforce the password policy server-side too, so it can't be bypassed by
  // editing the page: 8+ characters with at least one letter and one number.
  const pwErr = passwordProblem(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const result = await mutateSystem((sys) => {
    const store = sys.stores.find((st) => st.id === storeId);
    if (!store) {
      return { error: "Pick a valid store" };
    }
    // The login is the typed local part + the store's own domain, e.g.
    // sok@onmart-tk-592.kh — so every account is tied to its shop by its name.
    const username = buildLogin(localPart, store);
    if (!username) {
      return { error: "Enter a username" };
    }
    if (sys.users.some((u) => u.username.toLowerCase() === username)) {
      return { error: "That username is taken" };
    }
    // Area Managers carry a set of owner-assigned stores (besides their home).
    const storeIds =
      role === "area_manager" && Array.isArray(body.storeIds)
        ? body.storeIds.filter((id: unknown) => typeof id === "string" && sys.stores.some((st) => st.id === id))
        : undefined;
    const n = sys.nextUser++;
    const user: User = {
      id: `u${n}`,
      username,
      name,
      passwordHash: hashPassword(password),
      role,
      storeId,
      ...(storeIds && storeIds.length ? { storeIds } : {}),
      createdAt: new Date().toISOString(),
    };
    sys.users.push(user);
    return { user: { id: user.id, username, name, role, storeId } };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.user, { status: 201 });
}
