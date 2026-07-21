import { hashPassword } from "./password";
import type { Role } from "./auth";
import { readBlob, writeBlob } from "./blobStore";

// Path constants live in ./paths (to avoid an import cycle with blobStore).
// Re-exported here so existing `import { DATA_DIR } from "@/lib/system"` keeps working.
export { DATA_DIR, STORES_DIR } from "./paths";

export type Store = { id: string; name: string; createdAt: string };
export type User = {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  role: Role;
  storeId: string; // home store (owner may switch to any store)
  storeIds?: string[]; // extra stores an Area Manager may access (owner-assigned)
  createdAt: string;
};
export type SystemData = {
  stores: Store[];
  users: User[];
  nextStore: number;
  nextUser: number;
  // Owner-configurable page access per role (denied page paths). Falls back to
  // DEFAULT_ROLE_DENIED in access.ts until the owner customizes it here.
  rolePermissions?: Partial<Record<Role, string[]>>;
  // Owner-configurable capabilities per role (e.g. "cap:profit") — things that
  // aren't a page, so they can't be expressed as a denied path. Explicit
  // true/false; a missing key means "owner hasn't decided", which falls back to
  // CAP_BASELINE in access.ts. See the capabilities note there for why these
  // don't live in rolePermissions.
  roleCaps?: Partial<Record<Role, Record<string, boolean>>>;
};

// The default store keeps the existing ON Mart Tuol Kork demo data.
export const DEFAULT_STORE_ID = "onmart-tk";
export const DEFAULT_STORE_NAME = "ON Mart PP – Tuol Kork (Street 592)";

let sysWriteChain: Promise<unknown> = Promise.resolve();

// A second store + its first employee, provisioned in the seed so they persist
// even on hosting without a persistent disk (free tier re-seeds on restart).
const STORE_TK592_ID = "on-mart-tk-592";
const STORE_TK592_NAME = "ON Mart TK st.592";

function buildSystemSeed(): SystemData {
  const now = new Date().toISOString();
  return {
    stores: [
      { id: DEFAULT_STORE_ID, name: DEFAULT_STORE_NAME, createdAt: now },
      { id: STORE_TK592_ID, name: STORE_TK592_NAME, createdAt: now },
    ],
    users: [
      {
        id: "u1",
        username: "owner",
        name: "Owner",
        passwordHash: hashPassword(process.env.OWNER_PASSWORD || "sekuna2026"),
        role: "owner",
        storeId: DEFAULT_STORE_ID,
        createdAt: now,
      },
      {
        id: "u2",
        username: "Chanvibol",
        name: "Korn Chanvbol",
        passwordHash: hashPassword("Chanvilbol592"),
        role: "operations",
        storeId: STORE_TK592_ID,
        createdAt: now,
      },
      {
        // Management (CEO / Board): view-only across every store. Change the
        // password after first sign-in.
        id: "u3",
        username: "management",
        name: "Management",
        passwordHash: hashPassword(process.env.MANAGEMENT_PASSWORD || "board2026"),
        role: "management",
        storeId: DEFAULT_STORE_ID,
        createdAt: now,
      },
    ],
    nextStore: 3,
    nextUser: 4,
  };
}

// Cache the parsed system document (users, stores, permissions). It's read on
// almost every request (auth), so parsing it each time is wasted work. Writes go
// through mutateSystem, which updates this same object before persisting.
let sysCache: SystemData | null = null;

/** Drop the cached system document (e.g. after a restore writes it directly). */
export function reloadSystem(): void {
  sysCache = null;
}

export async function readSystem(): Promise<SystemData> {
  if (sysCache) return sysCache;
  const raw = await readBlob("system", "system");
  const sys = raw == null ? buildSystemSeed() : (JSON.parse(raw) as SystemData);
  if (raw == null) await writeBlob("system", "system", JSON.stringify(sys));
  if (!sys.stores) sys.stores = [];
  if (!sys.users) sys.users = [];
  if (sys.nextStore == null) sys.nextStore = sys.stores.length + 1;
  if (sys.nextUser == null) sys.nextUser = sys.users.length + 1;
  sysCache = sys;
  return sys;
}

export async function mutateSystem<T>(mutator: (sys: SystemData) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const sys = await readSystem();
    try {
      const result = await mutator(sys);
      await writeBlob("system", "system", JSON.stringify(sys));
      return result;
    } catch (e) {
      sysCache = null; // drop a possibly half-mutated copy; reload next time
      throw e;
    }
  };
  const next = sysWriteChain.then(run, run);
  sysWriteChain = next.catch(() => undefined);
  return next;
}

export async function storeExists(storeId: string): Promise<boolean> {
  const sys = await readSystem();
  return sys.stores.some((s) => s.id === storeId);
}
