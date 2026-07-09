import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const sys = await readSystem();
  const user = sys.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }

  const store = sys.stores.find((s) => s.id === user.storeId);
  const token = await signSession({
    uid: user.id,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
    storeName: store?.name || "Store",
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);

  return NextResponse.json({
    user: { name: user.name, role: user.role, storeId: user.storeId, storeName: store?.name },
  });
}
