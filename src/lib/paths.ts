import path from "path";

// Root data directory for the FILE backend (used when DATABASE_URL is not set,
// and as the source for the one-time import into Postgres). Set DATA_DIR to a
// persistent disk path in production.
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const STORES_DIR = path.join(DATA_DIR, "stores");
