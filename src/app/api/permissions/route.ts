import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem } from "@/lib/system";
import { DEFAULT_ROLE_DENIED, PERMISSION_PAGES, PERMISSION_ROLES } from "@/lib/access";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Owner-only: view/edit which pages each non-owner role may open. Stored in
// system.json (sys.rolePermissions), falling back to DEFAULT_ROLE_DENIED for
// any role the owner hasn't customized yet.
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (s.role !== "owner") return NextResponse.json({ error: "Only the owner can view permissions" }, { status: 403 });

  const sys = await readSystem();
  const permissions: Partial<Record<Role, string[]>> = {};
  for (const role of PERMISSION_ROLES) {
    permissions[role] = sys.rolePermissions?.[role] ?? DEFAULT_ROLE_DENIED[role] ?? [];
  }
  return NextResponse.json({ roles: PERMISSION_ROLES, pages: PERMISSION_PAGES, permissions });
}

// Toggle one role/page cell. Body: { role, href, allowed }. `allowed: true`
// removes the page from that role's denied list; `false` adds it.
export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (s.role !== "owner") return NextResponse.json({ error: "Only the owner can change permissions" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const role = body.role as Role;
  const href = String(body.href || "");
  const allowed = !!body.allowed;
  if (!PERMISSION_ROLES.includes(role)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  if (!PERMISSION_PAGES.some((p) => p.href === href)) return NextResponse.json({ error: "Unknown page" }, { status: 400 });

  const result = await mutateSystem((sys) => {
    if (!sys.rolePermissions) sys.rolePermissions = {};
    const current = sys.rolePermissions[role] ?? DEFAULT_ROLE_DENIED[role] ?? [];
    const next = allowed ? current.filter((h) => h !== href) : Array.from(new Set([...current, href]));
    sys.rolePermissions[role] = next;
    return next;
  });

  return NextResponse.json({ role, denied: result });
}
