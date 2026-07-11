import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem, type Store } from "@/lib/system";

export const dynamic = "force-dynamic";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sys = await readSystem();
  // Owner sees every store; a store user sees only their own store.
  const visible = s.role === "owner" ? sys.stores : sys.stores.filter((st) => st.id === s.storeId);
  const list = visible.map((st) => ({
    ...st,
    users: sys.users.filter((u) => u.storeId === st.id).length,
  }));
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owners only" }, { status: 403 });
  const { name } = await req.json().catch(() => ({}));
  const clean = String(name || "").trim();
  if (!clean) return NextResponse.json({ error: "Store name is required" }, { status: 400 });

  const result = await mutateSystem((sys) => {
    // Store names must be unique (case-insensitive) so the switcher is clear.
    if (sys.stores.some((st) => st.name.trim().toLowerCase() === clean.toLowerCase())) {
      return { error: "A store with that name already exists" as const };
    }
    const n = sys.nextStore++;
    let id = slug(clean) || `store-${n}`;
    if (sys.stores.some((st) => st.id === id)) id = `${id}-${n}`;
    const store: Store = { id, name: clean, createdAt: new Date().toISOString() };
    sys.stores.push(store);
    return { store };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  // Its data file (with a clean profile named after the store) is created
  // lazily on first access by ensureStoreFile.
  return NextResponse.json(result.store, { status: 201 });
}
