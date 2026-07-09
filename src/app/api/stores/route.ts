import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem, type Store } from "@/lib/system";

export const dynamic = "force-dynamic";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owners only" }, { status: 403 });
  const sys = await readSystem();
  const list = sys.stores.map((st) => ({
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

  const created = await mutateSystem((sys) => {
    const n = sys.nextStore++;
    let id = slug(clean) || `store-${n}`;
    if (sys.stores.some((st) => st.id === id)) id = `${id}-${n}`;
    const store: Store = { id, name: clean, createdAt: new Date().toISOString() };
    sys.stores.push(store);
    return store;
  });
  // Its data file (with a clean profile named after the store) is created
  // lazily on first access by ensureStoreFile.
  return NextResponse.json(created, { status: 201 });
}
