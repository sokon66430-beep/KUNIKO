import { readSystem } from "@/lib/system";
import { readDB } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { canApproveCash, canCancelInvoice, isCrossStoreRole } from "@/lib/access";

// A Job-Schedule position counts as "manager" (can approve) when its title reads
// like a manager or supervisor. Store Manager / Assistant Manager / Supervisor
// qualify; Cashier / Store Crew don't. Kept as a name test so a store can add its
// own manager/supervisor titles without a code change.
function isManagerPosition(name: string | undefined): boolean {
  return /manager|supervisor/i.test(name || "");
}

// Human job titles for account roles, so an approval can be recorded as
// "Sok Dara (Store Manager)" rather than "store_manager" — this text ends up on
// a cancellation slip a customer may be handed.
const ROLE_TITLES: Record<string, string> = {
  owner: "Owner",
  store_manager: "Store Manager",
  asst_store_manager: "Assistant Store Manager",
  area_manager: "Area Manager",
  ops_manager: "Operation Manager",
  management: "Management",
};

export function managerTitle(role: string): string {
  // A Job-Schedule position already IS its title ("Assistant Store Manager").
  return ROLE_TITLES[role] || role;
}

// Verify a manager/owner code on its own (no username) and return whose it is.
// Shared by the Till-Mode gate (/api/verify-manager) and any action that needs a
// manager to sign off — e.g. deleting a cash movement or unlocking a shift survey.
//   • default    → the OWNER (login password), OR any manager-position staff
//                  from Job Schedule using their 6-digit POS PIN — the SAME PIN
//                  they sign into the till with, so there's one code per person.
//   • ownerOnly  → the OWNER only.
//   • purpose    → which policy decides account-holder eligibility:
//                  "cancelInvoice" (default, canCancelInvoice — store's own
//                  leadership only) or "approveCash" (canApproveCash — the wider
//                  supervisor tier that also covers manager/area/ops roles), for
//                  shift surveys, shift close and cash-movement approval.
export async function findManagerByCode(
  code: string,
  opts: { ownerOnly?: boolean; storeId: string; purpose?: "cancelInvoice" | "approveCash" },
): Promise<{ name: string; role: string; title: string } | null> {
  const c = String(code || "").trim();
  if (!c) return null;

  // 1) Account holders (owner always; store/asst managers if they have a login).
  const sys = await readSystem();
  const isEligible = opts.purpose === "approveCash" ? canApproveCash : canCancelInvoice;
  const candidates = sys.users.filter((u) =>
    opts.ownerOnly
      ? u.role === "owner"
      : isEligible(u.role) &&
        (isCrossStoreRole(u.role) || u.storeId === opts.storeId || (u.storeIds || []).includes(opts.storeId)),
  );
  const mgr = candidates.find((u) => verifyPassword(c, u.passwordHash));
  if (mgr) return { name: mgr.name, role: mgr.role, title: managerTitle(mgr.role) };

  // 2) Job-Schedule staff PIN — a manager-position employee of THIS store typing
  //    their till PIN. Not offered for owner-only gates (Till Mode stays owner's).
  if (!opts.ownerOnly) {
    const db = await readDB(opts.storeId);
    const posName = new Map((db.positions || []).map((p) => [p.id, p.name]));
    const emp = (db.scheduleEmployees || []).find(
      (e) =>
        e.active !== false &&
        !!e.pinHash &&
        isManagerPosition(posName.get(e.positionId || "")) &&
        verifyPassword(c, e.pinHash as string),
    );
    if (emp) {
      const title = posName.get(emp.positionId || "") || "Manager";
      return { name: emp.name, role: title, title };
    }
  }

  return null;
}
