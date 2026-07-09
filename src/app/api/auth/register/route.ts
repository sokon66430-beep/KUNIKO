import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mutateSystem, type Store, type User } from "@/lib/system";
import { hashPassword } from "@/lib/password";
import { signSession, SESSION_COOKIE, cookieOptions, type Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Open self sign-up: anyone with the link can create their OWN store + login.
// Security guarantees enforced here (never trust the client for these):
//   • the account is ALWAYS store-scoped ("procurement"), NEVER a global owner
//   • a fresh store is created for them — they cannot attach to an existing store
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const storeName = String(body.storeName || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim() || storeName || username;
  const password = String(body.password || "");

  if (!storeName) return NextResponse.json({ error: "Store name is required" }, { status: 400 });
  if (!username) return NextResponse.json({ error: "Username is required" }, { status: 400 });
  if (password.length < 4) {
    return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
  }

  const result = await mutateSystem((sys) => {
    if (sys.users.some((u) => u.username.toLowerCase() === username)) {
      return { error: "That username is already taken" } as const;
    }
    // Create the store.
    const n = sys.nextStore++;
    let id = slug(storeName) || `store-${n}`;
    if (sys.stores.some((st) => st.id === id)) id = `${id}-${n}`;
    const store: Store = { id, name: storeName, createdAt: new Date().toISOString() };
    sys.stores.push(store);

    // Create the store-scoped account (role is fixed server-side).
    const un = sys.nextUser++;
    const role: Role = "procurement";
    const user: User = {
      id: `u${un}`,
      username,
      name,
      passwordHash: hashPassword(password),
      role,
      storeId: store.id,
      createdAt: new Date().toISOString(),
    };
    sys.users.push(user);
    return { store, user } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Sign them straight in so they land on "set up your store".
  const token = await signSession({
    uid: result.user.id,
    name: result.user.name,
    role: result.user.role,
    storeId: result.store.id,
    storeName: result.store.name,
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions);

  return NextResponse.json(
    { store: { id: result.store.id, name: result.store.name }, user: { name: result.user.name } },
    { status: 201 },
  );
}
