import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem, type User } from "@/lib/system";
import { hashPassword } from "@/lib/password";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["owner", "accountant", "procurement", "operations"];

export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owners only" }, { status: 403 });
  const sys = await readSystem();
  const list = sys.users.map((u) => ({
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
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owners only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim() || username;
  const password = String(body.password || "");
  const role: Role = ROLES.includes(body.role) ? body.role : "operations";
  const storeId = String(body.storeId || "");

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
