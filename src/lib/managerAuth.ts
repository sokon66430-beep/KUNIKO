import { readSystem } from "@/lib/system";
import { verifyPassword } from "@/lib/password";
import { canCancelInvoice, isCrossStoreRole } from "@/lib/access";

// Verify a manager/owner code on its own (no username) and return whose it is.
// Shared by the Till-Mode gate (/api/verify-manager) and any action that needs a
// manager to sign off — e.g. deleting a cash movement.
//   • default    → anyone who can approve a cancellation (store manager /
//                  assistant store manager / owner) for this store.
//   • ownerOnly  → the OWNER only.
export async function findManagerByCode(
  code: string,
  opts: { ownerOnly?: boolean; storeId: string },
): Promise<{ name: string; role: string } | null> {
  const c = String(code || "").trim();
  if (!c) return null;
  const sys = await readSystem();
  const candidates = sys.users.filter((u) =>
    opts.ownerOnly
      ? u.role === "owner"
      : canCancelInvoice(u.role) &&
        (isCrossStoreRole(u.role) || u.storeId === opts.storeId || (u.storeIds || []).includes(opts.storeId)),
  );
  const mgr = candidates.find((u) => verifyPassword(c, u.passwordHash));
  return mgr ? { name: mgr.name, role: mgr.role } : null;
}
