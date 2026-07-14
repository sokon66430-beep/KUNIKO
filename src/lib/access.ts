import type { Role } from "./auth";

// Every department (accountant, procurement, operations) can use every
// function, including "Stores & Employees" (where they may add employees to
// their own store — but NOT create stores; that button + API stay owner-only).
// Only the cross-store overview and the permissions matrix itself stay
// owner-only — everything else is configurable by the owner on /permissions.
// Edge-safe (type-only import) so the sidebar and middleware can share it.

const OWNER_ONLY = ["/all-stores", "/permissions", "/master-data"];

// Baseline used until the owner customizes access on /permissions (and as the
// floor middleware enforces, since it can't read the live per-store config —
// see /permissions page for the dynamic, owner-editable version of this).
// Area Manager and Manager sit under the Operations department, so by default
// they share Operations' restrictions rather than seeing everything.
const OPERATIONS_DENIED = ["/purchase-orders", "/invoices"];
export const DEFAULT_ROLE_DENIED: Partial<Record<Role, string[]>> = {
  operations: OPERATIONS_DENIED,
  manager: OPERATIONS_DENIED,
  area_manager: OPERATIONS_DENIED,
  accountant: ["/purchase-requests", "/purchase-orders", "/receiving", "/write-offs"],
};

// Every "function" the owner can toggle per role on the Permissions page.
// Dashboard ("/") is deliberately excluded — every signed-in role can always
// reach it, so a denied role always has somewhere safe to land.
export const PERMISSION_PAGES: { href: string; label: string }[] = [
  { href: "/pos", label: "Point of Sale" },
  { href: "/inventory", label: "Inventory" },
  { href: "/stock-count", label: "Stock Count" },
  { href: "/write-offs", label: "Write-Off" },
  { href: "/price-labels", label: "Price Labels" },
  { href: "/purchase-requests", label: "Purchase Requests" },
  { href: "/customers", label: "Customers" },
  { href: "/reports-center", label: "Reports" },
  { href: "/products", label: "Products" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/receiving", label: "Receiving" },
  { href: "/audit", label: "Audit Trail" },
  { href: "/invoices", label: "Invoices" },
  { href: "/stores", label: "Stores & Employees" },
  { href: "/settings", label: "Store Settings" },
];

// Roles the owner manages on the Permissions page (the owner always has full access).
export const PERMISSION_ROLES: Role[] = ["area_manager", "manager", "accountant", "procurement", "operations"];

function matches(pathname: string, base: string): boolean {
  return base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(base + "/");
}

// `denied` overrides the baseline for this specific role — pass the owner's
// live rolePermissions[role] (e.g. from the session API) where available;
// omit it (as middleware does) to fall back to the static baseline.
export function canAccessPage(role: Role, pathname: string, denied?: string[]): boolean {
  if (role === "owner") return true;
  if (OWNER_ONLY.some((p) => matches(pathname, p))) return false;
  const list = denied ?? DEFAULT_ROLE_DENIED[role];
  if (list && list.some((p) => matches(pathname, p))) return false;
  return true; // all departments see every other function
}

// Who may manage (add / delete) employees. Owners plus store leadership —
// managers and area managers — can; regular departments cannot delete staff.
export function canManageStaff(role: Role): boolean {
  return role === "owner" || role === "manager" || role === "area_manager";
}

// Profit/margin figures (Dashboard, Reports, POS Sales Report) are a level
// more sensitive than the pages above — restricted to Procurement, who
// negotiate cost, plus the owner. Cost is gated the same way: showing revenue
// and cost side by side lets anyone back out the profit anyway.
export function canSeeProfit(role: Role): boolean {
  return role === "owner" || role === "procurement";
}

// Who may switch the active store from the sidebar. The owner (all stores),
// plus Procurement and Accounting, who work across stores (ordering,
// invoices/reports). Shop-floor roles stay pinned to their own store.
export function canSwitchStores(role: Role): boolean {
  return role === "owner" || role === "procurement" || role === "accountant";
}
