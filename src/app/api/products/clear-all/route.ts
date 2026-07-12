import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// Delete EVERY product in the current store so a fresh master can be
// imported. Owner-only, and the owner must re-enter their password — a
// signed-in session alone isn't enough for something this destructive.
// Sales/PO/receipt history keeps its own item copies, so past records
// still read correctly; only the product master is emptied.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can clear products." }, { status: 403 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (!password) {
    return NextResponse.json({ error: "Password is required to approve this." }, { status: 400 });
  }
  const sys = await readSystem();
  const user = sys.users.find((u) => u.id === session.uid);
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return NextResponse.json({ error: "Wrong password — nothing was deleted." }, { status: 403 });
  }

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const removed = db.products.length;
    db.products = [];
    logAudit(db, {
      actor,
      action: "Cleared",
      entityType: "Product",
      entity: "All products",
      detail: `${removed} product${removed === 1 ? "" : "s"} deleted (password-approved)`,
    });
    return { removed };
  });

  return NextResponse.json(result);
}
