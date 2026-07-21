import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { mutateSystem } from "@/lib/system";
import { buildLogin } from "@/lib/userIdentity";

export const dynamic = "force-dynamic";

// Owner-only: convert every EXISTING account's login to the store-scoped email
// format (name@onmart-<store>.kh) that new accounts already use. Passwords are
// untouched, and current sessions keep working (they key on the user id, not the
// name). Idempotent — an account already in the format is skipped — and it
// dedupes any collision. Returns the old->new mapping so the owner can tell each
// person their new login.
export async function POST() {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const changes = await mutateSystem((sys) => {
    const storeById = new Map(sys.stores.map((st) => [st.id, st]));
    const taken = new Set(sys.users.map((u) => u.username.toLowerCase()));
    const out: { id: string; name: string; from: string; to: string }[] = [];

    for (const u of sys.users) {
      const store = storeById.get(u.storeId);
      let next = buildLogin(u.username, store);
      // Skip if it can't be built or is already the target (already email-style).
      if (!next || next.toLowerCase() === u.username.toLowerCase()) continue;

      // Dedupe against every other login (old or already-converted this run).
      if (taken.has(next.toLowerCase())) {
        const at = next.indexOf("@");
        const local = next.slice(0, at);
        const domain = next.slice(at + 1);
        let n = 2;
        while (taken.has(`${local}${n}@${domain}`.toLowerCase())) n++;
        next = `${local}${n}@${domain}`;
      }

      taken.delete(u.username.toLowerCase());
      taken.add(next.toLowerCase());
      out.push({ id: u.id, name: u.name, from: u.username, to: next });
      u.username = next;
    }
    return out;
  });

  return NextResponse.json({ converted: changes.length, changes });
}
