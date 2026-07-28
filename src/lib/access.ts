import type { Role } from "./auth";

// Every department (accountant, procurement, operations) can use every
// function, including "Stores & Employees" (where they may add employees to
// their own store — but NOT create stores; that button + API stay owner-only).
// Only the cross-store overview and the permissions matrix itself stay
// owner-only — everything else is configurable by the owner on /permissions.
// Edge-safe (type-only import) so the sidebar and middleware can share it.

const OWNER_ONLY = [
  "/all-stores",
  "/permissions",
  "/menu-layout",
  // "/master-data" is NOT here: it's owner-configurable per role on
  // /permissions, as the cap:master-data capability (see below). A capability
  // (explicit true/false, undefined = denied) rather than a denied-list entry,
  // because every list saved before the toggle existed can't mention it — and
  // in a denied-list, absent reads as allowed, which would have silently handed
  // the company-wide master file to every configured role.
  // Migration surfaces: opening inventory rewrites stock wholesale, purchase
  // history is company-level data, and the ledger is the book behind both.
  "/opening-inventory",
  "/historical-purchases",
  "/inventory-ledger",
];

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
  { href: "/money", label: "Cash Management" },
  { href: "/queue", label: "Pickup Queue" },
  { href: "/queue-management", label: "Queue Management" },
  { href: "/inventory", label: "Inventory" },
  { href: "/stock-count", label: "Stock Count" },
  { href: "/write-offs", label: "Write-Off" },
  { href: "/price-labels", label: "Price Labels" },
  { href: "/promotions", label: "Mark Down" },
  { href: "/coupons", label: "Coupons" },
  { href: "/markdown-reports", label: "Mark Down Reports" },
  { href: "/recipes", label: "Recipes" },
  { href: "/recipe-reports", label: "Recipe Reports" },
  // URL is /deals: /promotions was kept by the Mark Down page (renaming it
  // would drop the saved per-role access, which is keyed on the href).
  { href: "/deals", label: "Promotions" },
  { href: "/promotion-reports", label: "Promotion Reports" },
  { href: "/unit-sales", label: "Selling Unit Reports" },
  { href: "/purchase-requests", label: "Purchase Requests" },
  { href: "/job-schedule", label: "Job Schedule" },
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
  { href: "/customization", label: "Customization" },
  { href: "/settings", label: "Store Settings" },
];

// ---------------------------------------------------------------------------
// Capabilities
//
// A capability is something a role may SEE, not a page it may open — profit and
// cost show up on the Dashboard, Reports, POS and half a dozen exports, so
// there's no URL to deny.
//
// They are stored apart from the denied-page lists (system.json roleCaps, an
// explicit true/false per role) and NOT as another entry in `denied`. That looks
// like duplication but isn't: a denied list says what's forbidden, so anything
// absent is allowed — and every list saved before a capability existed is,
// necessarily, absent. Filing profit in there would have read as "allowed" for
// every role the owner had already configured, and shipping it would have handed
// margin to Store Crew. An explicit flag can say "not decided yet" (undefined)
// and fall through to the baseline below, which is the whole point.
// ---------------------------------------------------------------------------

export const PROFIT_CAP = "cap:profit";
export const MASTER_DATA_CAP = "cap:master-data";

export type RoleCaps = Partial<Record<string, boolean>>;

// Rows the owner can toggle that aren't pages. `note` explains what the toggle
// covers, since unlike a page the name alone doesn't say where it shows up.
export const PERMISSION_CAPS: { href: string; label: string; note: string }[] = [
  {
    href: PROFIT_CAP,
    label: "Profit & Cost",
    note: "Profit, margin and cost prices on the Dashboard, Reports, POS and exports",
  },
  {
    href: MASTER_DATA_CAP,
    label: "Master Data",
    note: "The company-wide master file — create and edit products, suppliers, recipes and deals for every store",
  },
];

// Who gets a capability until the owner says otherwise. Profit/margin figures
// are a level more sensitive than the pages above — Procurement negotiate cost,
// so they've always had it. Cost is gated the same way: showing revenue and cost
// side by side lets anyone back out the profit anyway.
const CAP_BASELINE: Record<string, Role[]> = {
  [PROFIT_CAP]: ["procurement"],
  // Nobody gets the master file until the owner grants it by hand — one master
  // edit rewrites products for every store, so there is no safe default.
  [MASTER_DATA_CAP]: [],
};

export function hasCap(role: Role, cap: string, caps?: RoleCaps): boolean {
  // Owner and Management have every capability, the same way they have every
  // page — their columns aren't toggleable on /permissions.
  if (role === "owner" || role === "management") return true;
  const set = caps?.[cap];
  return set === undefined ? (CAP_BASELINE[cap] ?? []).includes(role) : set;
}

// Roles the owner manages on the Permissions page (the owner always has full
// access). The legacy "manager" and "operations" roles are deliberately NOT
// here: they duplicate Store Manager / Operation Manager, can no longer be
// assigned from the employee form, and only cluttered the matrix. Accounts
// still carrying them keep working through the baseline defaults.
export const PERMISSION_ROLES: Role[] = [
  "store_crew",
  "store_manager",
  "asst_store_manager",
  "area_manager",
  "ops_manager",
  "procurement",
  "accountant",
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

// Who counts as a "supervisor" for the pickup-number queue: may reset the
// counter and cancel a wrong number. Cashiers (any signed-in till user) can
// already generate and view numbers; these two actions are the extra power.
// Same set as staff management — store leadership and above.
export function canManageQueue(role: Role): boolean {
  return canManageStaff(role);
}

// Money management roles.
//   Cashier  — any signed-in till user: open a shift, count, request a drop.
//   Supervisor — approve cash movements & variances, approve a shift close.
//   Manager  — reopen a locked shift (always audited) and change cash settings.
// Supervisor mirrors staff management (store leadership and above); manager is
// the higher tier that can undo a locked shift.
export function canApproveCash(role: Role): boolean {
  return canManageStaff(role);
}
export function canReopenShift(role: Role): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "area_manager" ||
    role === "store_manager" ||
    role === "manager"
  );
}

// Who may ASSIGN the Job Schedule roster (set each person's shift / day off).
// Store + regional leadership manage rotation by hand — everyone else (crew,
// accountant, procurement) can open the schedule but only to view/print it.
export function canAssignRoster(role: Role): boolean {
  return (
    role === "owner" ||
    role === "management" ||
    role === "ops_manager" ||
    role === "area_manager" ||
    role === "store_manager" ||
    role === "asst_store_manager" ||
    role === "manager"
  );
}

// Who may cancel (void) a sale invoice. Authorised by the STORE's own leadership
// — the store manager or assistant store manager (owner always). A void happens
// on the shop floor, so regional managers and departments are excluded.
export function canCancelInvoice(role: Role): boolean {
  return role === "owner" || role === "store_manager" || role === "asst_store_manager";
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

// Profit/margin figures (Dashboard, Reports, POS Sales Report, exports).
// Owner-configurable per role on /permissions — pass the live caps for that
// role (server: `profitFor` in lib/caps.ts; client: `useAccess`). Called
// without them it answers from the baseline, which is the pre-/permissions
// behaviour: Owner, Management and Procurement.
export function canSeeProfit(role: Role, caps?: RoleCaps): boolean {
  return hasCap(role, PROFIT_CAP, caps);
}

// Master Data (company-wide products/suppliers/recipes/deals). Owner always;
// other roles only when granted on /permissions. Pass the live caps where
// available (server: `masterDataFor` in lib/caps.ts; client: `useAccess`).
export function canUseMasterData(role: Role, caps?: RoleCaps): boolean {
  return hasCap(role, MASTER_DATA_CAP, caps);
}

// Who may pull a fresh price list onto a till.
//
// The catalogue loads when the till starts and refreshes overnight; this is the
// override for a price that has to be corrected today. It sits with the people
// who own what the prices ARE — procurement, and the owner — rather than with
// whoever is standing at the counter. A cashier pulling a mid-edit price list
// onto a live till is the failure this prevents.
export function canSyncCatalog(role: Role): boolean {
  return role === "owner" || role === "procurement";
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
