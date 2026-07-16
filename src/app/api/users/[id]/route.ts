import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem } from "@/lib/system";
import { canManageStaff, isCrossStoreRole } from "@/lib/access";
import { hashPassword } from "@/lib/password";
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

// Edit an employee (name, username, role, store, and optionally a new
// password). Same permission model as delete: owners edit anyone; store
// leadership only staff in their own store, never owners, and can't grant
// the owner role. The last owner can't be demoted.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "You don't have permission to edit employees" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  const result = await mutateSystem((sys) => {
    const target = sys.users.find((u) => u.id === params.id);
    if (!target) return { error: "Employee not found", status: 404 };

    if (s.role !== "owner") {
      if (target.storeId !== s.storeId) return { error: "You can only edit staff in your own store", status: 403 };
      // Cross-store, elevated roles (owner, management, ops/area manager): a store
      // user can neither edit one nor promote anyone into one.
      if (isCrossStoreRole(target.role))
        return { error: "Only an owner can edit a cross-store account", status: 403 };
      if (typeof body.role === "string" && isCrossStoreRole(body.role as Role))
        return { error: "Only an owner can grant a cross-store role", status: 403 };
    }

    if (typeof body.username === "string" && body.username.trim()) {
      const uname = body.username.trim();
      if (sys.users.some((u) => u.id !== target.id && u.username.toLowerCase() === uname.toLowerCase())) {
        return { error: "That username is already taken", status: 400 };
      }
      target.username = uname;
    }
    if (typeof body.name === "string" && body.name.trim()) target.name = body.name.trim();
    if (typeof body.role === "string" && ROLES.includes(body.role as Role)) {
      // Never demote the last remaining owner.
      if (target.role === "owner" && body.role !== "owner" && sys.users.filter((u) => u.role === "owner").length <= 1) {
        return { error: "You can't demote the last owner", status: 400 };
      }
      target.role = body.role as Role;
    }
    if (typeof body.storeId === "string" && body.storeId && sys.stores.some((st) => st.id === body.storeId)) {
      target.storeId = body.storeId;
    }
    // Owner-assigned extra stores for an Area Manager. Cleared automatically if
    // the role is no longer Area Manager.
    if (target.role === "area_manager") {
      if (Array.isArray(body.storeIds)) {
        target.storeIds = body.storeIds.filter(
          (id: unknown) => typeof id === "string" && sys.stores.some((st) => st.id === id),
        );
      }
    } else if (target.storeIds) {
      delete target.storeIds;
    }
    if (typeof body.password === "string" && body.password.trim()) {
      target.passwordHash = hashPassword(body.password.trim());
    }
    return {
      user: {
        id: target.id,
        username: target.username,
        name: target.name,
        role: target.role,
        storeId: target.storeId,
        storeIds: target.storeIds ?? [],
      },
    };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.user);
}

// Delete an employee. Allowed for owners and store leadership (manager /
// area manager). Guards prevent lockouts and privilege games:
//  - you can't delete your own account
//  - non-owners can only delete staff in their OWN store, and never an owner
//  - the last remaining owner can never be deleted
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageStaff(s.role)) {
    return NextResponse.json({ error: "You don't have permission to remove employees" }, { status: 403 });
  }

  const sys = await readSystem();
  const target = sys.users.find((u) => u.id === params.id);
  if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  if (target.id === s.uid) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }
  if (s.role !== "owner") {
    if (target.storeId !== s.storeId) {
      return NextResponse.json({ error: "You can only remove staff in your own store" }, { status: 403 });
    }
    if (target.role === "owner") {
      return NextResponse.json({ error: "Only an owner can remove an owner" }, { status: 403 });
    }
  }
  if (target.role === "owner" && sys.users.filter((u) => u.role === "owner").length <= 1) {
    return NextResponse.json({ error: "You can't remove the last owner" }, { status: 400 });
  }

  await mutateSystem((db) => {
    db.users = db.users.filter((u) => u.id !== params.id);
    return true;
  });
  return NextResponse.json({ ok: true });
}
