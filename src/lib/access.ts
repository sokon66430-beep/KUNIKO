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
// Store Crew are shop-floor only — POS, inventory, stock count, write-off, price
// labels, customers and reports. Procurement, accounting and admin stay hidden.
const CREW_DENIED = [
  "/purchase-orders",
  "/purchase-requests",
  "/receiving",
  "/receipts",
  "/invoices",
  "/products",
  "/suppliers",
  "/audit",
  "/business-reports",
  "/stores",
  "/settings",
];
export const DEFAULT_ROLE_DENIED: Partial<Record<Role, string[]>> = {
  operations: OPERATIONS_DENIED,
  manager: OPERATIONS_DENIED,
  area_manager: OPERATIONS_DENIED,
  ops_manager: OPERATIONS_DENIED,
  store_manager: OPERATIONS_DENIED,
  asst_store_manager: OPERATIONS_DENIED,
  store_crew: CREW_DENIED,
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
  { href: "/promotions", label: "Mark Down" },
  { href: "/markdown-reports", label: "Mark Down Reports" },
  { href: "/recipes", label: "Recipes" },
  { href: "/recipe-reports", label: "Recipe Reports" },
  // URL is /deals: /promotions was kept by the Mark Down page (renaming it
  // would drop the saved per-role access, which is keyed on the href).
  { href: "/deals", label: "Promotions" },
  { href: "/promotion-reports", label: "Promotion Reports" },
  { href: "/unit-sales", label: "Selling Unit Reports" },
  { href: "/purchase-requests", label: "Purchase Requests" },
  { href: "/customers", label: "Customers" },
  { href: "/reports-center", label: "Reports" },
  { href: "/business-reports", label: "Business Reports" },
  { href: "/products", label: "Products" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/receiving", label: "Receiving" },
  { href: "/receipts", label: "Receipt History" },
  { href: "/audit", label: "Audit Trail" },
  { href: "/invoices", label: "Invoices" },
  { href: "/stores", label: "Stores & Employees" },
  { href: "/settings", label: "Store Settings" },
];

// Roles the owner manages on the Permissions page (the owner always has full access).
export const PERMISSION_ROLES: Role[] = [
  "store_crew",
  "store_manager",
  "asst_store_manager",
  "area_manager",
  "ops_manager",
  "procurement",
  "accountant",
  "manager",
  "operations",
];

function matches(pathname: string, base: string): boolean {
  return base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(base + "/");
}

// `denied` overrides the baseline for this specific role — pass the owner's
// live rolePermissions[role] (e.g. from the session API) where available;
// omit it (as middleware does) to fall back to the static baseline.
/**
 * Pages carved out of an existing page: split → original.
 *
 * A role denied the ORIGINAL is denied the split-off one too. This matters
 * because per-role permissions are SAVED against the href: a brand-new href has
 * no saved entry, so an owner's existing settings couldn't possibly mention it,
 * and everyone they'd already shut out of the original would silently get the
 * new page. Splitting a screen must never hand out access nobody granted.
 *
 * Once an owner sets the new page explicitly on /permissions, their own choice
 * is in `denied` and wins on its own.
 */
const SPLIT_FROM: Record<string, string> = {
  "/receipts": "/receiving", // receipt history was the lower half of Receiving
  "/markdown-reports": "/promotions", // finished labels used to sit on the Mark Down list
};

export function canAccessPage(role: Role, pathname: string, denied?: string[]): boolean {
  if (role === "owner") return true;
  // Management (CEO / Board) may open every screen — the write-block (middleware
  // + client guard) is what keeps them from changing anything.
  if (role === "management") return true;
  if (OWNER_ONLY.some((p) => matches(pathname, p))) return false;
  const list = denied ?? DEFAULT_ROLE_DENIED[role];
  if (!list) return true;
  if (list.some((p) => matches(pathname, p))) return false;
  // Inherit the parent page's denial, unless this page has been decided on its
  // own (i.e. the owner has saved a list that names it).
  for (const [split, origin] of Object.entries(SPLIT_FROM)) {
    if (matches(pathname, split) && !list.includes(split) && list.some((p) => matches(origin, p))) {
      return false;
    }
  }
  return true; // all departments see every other function
}

// Who may manage (add / delete) employees. Owners plus store/area/ops
// leadership; shop-floor crew and departments cannot.
export function canManageStaff(role: Role): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "area_manager" ||
    role === "store_manager" ||
    role === "asst_store_manager" ||
    role === "manager"
  );
}

// Cross-store, elevated roles — only an owner may create or assign these. Area
// Manager reaches multiple owner-assigned stores; Operation Manager reaches all.
export function isCrossStoreRole(role: Role): boolean {
  return role === "owner" || role === "management" || role === "ops_manager" || role === "area_manager";
}

// Roles whose data spans EVERY store (used to build the store-switcher list and
// validate a store switch). Area Manager is deliberately excluded — it reaches
// only the specific stores the owner assigned (User.storeIds).
export function reachesAllStores(role: Role): boolean {
  return (
    role === "owner" ||
    role === "management" ||
    role === "ops_manager" ||
    role === "procurement" ||
    role === "accountant"
  );
}

// Profit/margin figures (Dashboard, Reports, POS Sales Report) are a level
// more sensitive than the pages above — restricted to Procurement, who
// negotiate cost, plus the owner. Cost is gated the same way: showing revenue
// and cost side by side lets anyone back out the profit anyway.
export function canSeeProfit(role: Role): boolean {
  return role === "owner" || role === "procurement" || role === "management";
}

// Who may put a product on markdown. Cutting a price 30–70% is a margin
// decision, so it stays with store leadership and above — crew print and stick
// the labels, but don't decide the discount.
export function canMarkDown(role: Role): boolean {
  return (
    role === "owner" ||
    role === "store_manager" ||
    role === "asst_store_manager" ||
    role === "area_manager" ||
    role === "ops_manager" ||
    role === "manager" ||
    role === "operations"
  );
}

// Who may write a recipe. Changing what goes in a bowl changes food cost and
// what comes off stock on every future sale, so it sits with store leadership
// and above — crew cook to the recipe, they don't rewrite it.
export function canManageRecipes(role: Role): boolean {
  return (
    role === "owner" ||
    role === "store_manager" ||
    role === "asst_store_manager" ||
    role === "area_manager" ||
    role === "ops_manager" ||
    role === "manager" ||
    role === "operations"
  );
}

// Who may write a promotion. A deal applies itself to every basket that
// qualifies, with no one at the till to catch a mistake — so setting one up is
// a margin decision that stays with store leadership and above.
export function canManagePromotions(role: Role): boolean {
  return (
    role === "owner" ||
    role === "store_manager" ||
    role === "asst_store_manager" ||
    role === "area_manager" ||
    role === "ops_manager" ||
    role === "manager" ||
    role === "operations"
  );
}

// View-only roles: may read every screen but can never change data. Enforced as
// a hard block on mutating API calls in middleware, mirrored by a client guard
// so edit controls fail with a clear message instead of a raw 403.
export function isReadOnly(role: Role): boolean {
  return role === "management";
}

// Cross-store overview + Store Performance: leadership only (owner + the
// CEO/Board management role).
export function canSeeAllStores(role: Role): boolean {
  return role === "owner" || role === "management";
}

// Who may switch the active store from the sidebar. The owner and Operation
// Manager (all stores), the Area Manager (their assigned stores), plus
// Procurement and Accounting, who work across stores. Single-store retail roles
// stay pinned to their own store.
export function canSwitchStores(role: Role): boolean {
  return (
    role === "owner" ||
    role === "management" ||
    role === "ops_manager" ||
    role === "area_manager" ||
    role === "procurement" ||
    role === "accountant"
  );
}
