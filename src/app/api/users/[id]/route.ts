import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readSystem, mutateSystem } from "@/lib/system";
import { canManageStaff } from "@/lib/access";

export const dynamic = "force-dynamic";

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
