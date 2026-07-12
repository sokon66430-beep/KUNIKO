import { promises as fs } from "fs";
import path from "path";
import { hashPassword } from "./password";
import type { Role } from "./auth";

// Root data directory — set DATA_DIR to a persistent disk path in production.
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const STORES_DIR = path.join(DATA_DIR, "stores");
const SYSTEM_FILE = path.join(DATA_DIR, "system.json");

export type Store = { id: string; name: string; createdAt: string };
export type User = {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  role: Role;
  storeId: string; // home store (owner may switch to any store)
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
    ],
    nextStore: 3,
    nextUser: 3,
  };
}

async function ensureSystem(): Promise<void> {
  try {
    await fs.access(SYSTEM_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SYSTEM_FILE, JSON.stringify(buildSystemSeed(), null, 2), "utf8");
  }
}

export async function readSystem(): Promise<SystemData> {
  await ensureSystem();
  const raw = await fs.readFile(SYSTEM_FILE, "utf8");
  const sys = JSON.parse(raw) as SystemData;
  if (!sys.stores) sys.stores = [];
  if (!sys.users) sys.users = [];
  if (sys.nextStore == null) sys.nextStore = sys.stores.length + 1;
  if (sys.nextUser == null) sys.nextUser = sys.users.length + 1;
  return sys;
}

export async function mutateSystem<T>(mutator: (sys: SystemData) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const sys = await readSystem();
    const result = await mutator(sys);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SYSTEM_FILE, JSON.stringify(sys, null, 2), "utf8");
    return result;
  };
  const next = sysWriteChain.then(run, run);
  sysWriteChain = next.catch(() => undefined);
  return next;
}

export async function storeExists(storeId: string): Promise<boolean> {
  const sys = await readSystem();
  return sys.stores.some((s) => s.id === storeId);
}
