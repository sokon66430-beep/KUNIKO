import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem, type User } from "@/lib/system";
import { hashPassword } from "@/lib/password";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["owner", "area_manager", "manager", "accountant", "procurement", "operations"];

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sys = await readSystem();
  // Owner sees every employee; a store user sees only their own store's team.
  const visible = s.role === "owner" ? sys.users : sys.users.filter((u) => u.storeId === s.storeId);
  const list = visible.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    storeId: u.storeId,
    storeName: sys.stores.find((st) => st.id === u.storeId)?.name || "—",
  }));
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const isOwner = s.role === "owner";
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim() || username;
  const password = String(body.password || "");
  let role: Role = ROLES.includes(body.role) ? body.role : "operations";
  // A store user may only add employees to their OWN store, and can never mint
  // an owner account (no privilege escalation). Owners may add to any store.
  let storeId = String(body.storeId || "");
  if (!isOwner) {
    storeId = s.storeId;
    if (role === "owner") {
      return NextResponse.json({ error: "Only an owner can create an owner account" }, { status: 403 });
    }
  }

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const result = await mutateSystem((sys) => {
    if (sys.users.some((u) => u.username.toLowerCase() === username)) {
      return { error: "That username is taken" };
    }
    if (!sys.stores.some((st) => st.id === storeId)) {
      return { error: "Pick a valid store" };
    }
    const n = sys.nextUser++;
    const user: User = {
      id: `u${n}`,
      username,
      name,
      passwordHash: hashPassword(password),
      role,
      storeId,
      createdAt: new Date().toISOString(),
    };
    sys.users.push(user);
    return { user: { id: user.id, username, name, role, storeId } };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.user, { status: 201 });
}
