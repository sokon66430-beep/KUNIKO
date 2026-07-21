import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR, STORES_DIR } from "./paths";

/**
 * Blob storage for the whole-store JSON documents (Stage 1 of the Postgres move).
 *
 * Two backends, chosen at runtime:
 *  - Postgres, when DATABASE_URL is set — one JSONB row per document in `kv_store`.
 *    Gives durability, automatic backups and the ability to run more than one
 *    web instance (a single disk no longer owns the data).
 *  - Files, otherwise — the original data/stores/*.json + data/system.json.
 *    So nothing changes for an install that hasn't set up a database yet.
 *
 * The document shape (a store's full DB object, the system object) is unchanged;
 * this layer only swaps WHERE the JSON is kept. Stage 2 breaks the big documents
 * into proper tables — this is the safe, invisible first step.
 */

const url = process.env.DATABASE_URL;
export function usingPostgres(): boolean {
  return !!url;
}

// A single shared pool. Kept on globalThis so Next.js hot-reload / repeated
// module evaluation doesn't open a new pool each time.
type PgPool = import("pg").Pool;
const g = globalThis as unknown as { _stookiiPgPool?: PgPool; _stookiiPgReady?: Promise<void> };

async function getPool(): Promise<PgPool> {
  if (!g._stookiiPgPool) {
    const { Pool } = await import("pg");
    // Render's INTERNAL host is a single name (no dots) and needs no SSL; any
    // host with a dot (external Render/Neon/etc.) does. rejectUnauthorized:false
    // matches how managed providers present their certs.
    const host = (url!.match(/@([^/:]+)/) || [])[1] || "";
    const ssl = host.includes(".") ? { rejectUnauthorized: false } : undefined;
    g._stookiiPgPool = new Pool({ connectionString: url, ssl, max: 10 });
  }
  return g._stookiiPgPool;
}

async function ensureReady(): Promise<void> {
  if (!g._stookiiPgReady) g._stookiiPgReady = init();
  return g._stookiiPgReady;
}

async function init(): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS kv_store (
       kind text NOT NULL,
       id   text NOT NULL,
       data jsonb NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (kind, id)
     )`,
  );
  // First boot on an EMPTY database: copy whatever is already on the local disk
  // (the current live data) into Postgres, once. Read-only on the files, so the
  // originals stay intact and we can fall back by removing DATABASE_URL.
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM kv_store`);
  if (rows[0]?.n === 0) {
    await importFromFiles(pool);
  }
}

async function rawPut(pool: PgPool, kind: string, id: string, jsonText: string): Promise<void> {
  await pool.query(
    `INSERT INTO kv_store (kind, id, data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [kind, id, jsonText],
  );
}

async function importFromFiles(pool: PgPool): Promise<void> {
  let imported = 0;
  try {
    const sys = await fs.readFile(path.join(DATA_DIR, "system.json"), "utf8");
    await rawPut(pool, "system", "system", sys);
    imported++;
  } catch {
    /* no system file yet — the app will seed one */
  }
  try {
    const files = await fs.readdir(STORES_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/, "");
      const data = await fs.readFile(path.join(STORES_DIR, f), "utf8");
      await rawPut(pool, "store", id, data);
      imported++;
    }
  } catch {
    /* no stores dir yet */
  }
  if (imported > 0) {
    // Visible in the deploy logs so the one-time import is auditable.
    console.log(`[blobStore] Imported ${imported} document(s) from local files into Postgres.`);
  }
}

function filePath(kind: string, id: string): string {
  if (kind === "system") return path.join(DATA_DIR, "system.json");
  // A store id is always a plain slug; refuse anything else so a stray id can
  // never contain "../" or a separator and escape STORES_DIR.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid store id: ${id}`);
  return path.join(STORES_DIR, `${id}.json`);
}

/** Read a document's JSON text, or null if it doesn't exist yet. */
export async function readBlob(kind: string, id: string): Promise<string | null> {
  if (usingPostgres()) {
    await ensureReady();
    const pool = await getPool();
    const { rows } = await pool.query<{ t: string }>(
      `SELECT data::text AS t FROM kv_store WHERE kind = $1 AND id = $2`,
      [kind, id],
    );
    return rows.length ? rows[0].t : null;
  }
  try {
    return await fs.readFile(filePath(kind, id), "utf8");
  } catch {
    return null;
  }
}

/** Write (create or replace) a document's JSON text. */
export async function writeBlob(kind: string, id: string, jsonText: string): Promise<void> {
  if (usingPostgres()) {
    await ensureReady();
    const pool = await getPool();
    await rawPut(pool, kind, id, jsonText);
    return;
  }
  const file = filePath(kind, id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, jsonText, "utf8");
}
