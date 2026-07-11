import type { Role } from "./auth";

// Every department (accountant, procurement, operations) can use every
// function, including "Stores & Employees" (where they may add employees to
// their own store — but NOT create stores; that button + API stay owner-only).
// Only the cross-store overview stays owner-only.
// Edge-safe (type-only import) so the sidebar and middleware can share it.

const OWNER_ONLY = ["/all-stores"];

// Pages a specific role may NOT use. Operations staff run the shop floor and
// don't handle purchasing, so the Purchase functions are hidden from them.
const ROLE_DENIED: Partial<Record<Role, string[]>> = {
  operations: ["/purchase-requests", "/purchase-orders"],
};

function matches(pathname: string, base: string): boolean {
  return base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(base + "/");
}

export function canAccessPage(role: Role, pathname: string): boolean {
  if (role === "owner") return true;
  if (OWNER_ONLY.some((p) => matches(pathname, p))) return false;
  const denied = ROLE_DENIED[role];
  if (denied && denied.some((p) => matches(pathname, p))) return false;
  return true; // all departments see every other function
}

// Who may manage (add / delete) employees. Owners plus store leadership —
// managers and area managers — can; regular departments cannot delete staff.
export function canManageStaff(role: Role): boolean {
  return role === "owner" || role === "manager" || role === "area_manager";
}
