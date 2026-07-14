import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { mutateSystem } from "@/lib/system";

export const dynamic = "force-dynamic";

// Rename a store (owner only). The store's on-file data (products, orders…)
// is untouched — only its display name changes.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Store name is required" }, { status: 400 });

  const result = await mutateSystem((sys) => {
    const store = sys.stores.find((st) => st.id === params.id);
    if (!store) return null;
    store.name = name;
    return store;
  });

  if (!result) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  return NextResponse.json(result);
}
