import fs from "fs/promises";
import { statfs } from "fs/promises";
import path from "path";
import { DATA_DIR } from "./paths";
import { readBlob } from "./blobStore";
import { writeFileAtomic } from "./atomicWrite";
import { readSystem } from "./system";

// A full backup = the system (stores + logins) plus every store's data, in one
// JSON document. Read through the storage layer so it works on both the file and
// the Postgres backend. Shared by the manual download route and the automatic
// daily backup below.
export async function buildBackup(): Promise<{
  version: number;
  exportedAt: string;
  system: unknown;
  stores: Record<string, unknown>;
}> {
  const sys = await readSystem();
  const stores: Record<string, unknown> = {};
  for (const st of sys.stores) {
    const raw = await readBlob("store", st.id);
    if (raw != null) stores[st.id] = JSON.parse(raw);
  }
  return { version: 1, exportedAt: new Date().toISOString(), system: sys, stores };
}

const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP_DAYS = Math.max(3, Number(process.env.BACKUP_KEEP_DAYS) || 14);

function backupFileFor(dateStr: string): string {
  return path.join(BACKUP_DIR, `stookii-backup-${dateStr}.json`);
}

/** Never drop below this many backups, whatever the disk is doing. */
const MIN_KEEP = 3;

/** The backup files on disk, oldest first, with their sizes. */
async function backupFiles(): Promise<Array<{ name: string; bytes: number }>> {
  const names = (await fs.readdir(BACKUP_DIR).catch(() => []))
    .filter((f) => /^stookii-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // date-stamped names sort oldest → newest
  const out: Array<{ name: string; bytes: number }> = [];
  for (const name of names) {
    const st = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (st) out.push({ name, bytes: st.size });
  }
  return out;
}

/** Free bytes on the volume the backups live on, or null if unmeasurable. */
async function freeBytes(): Promise<number | null> {
  try {
    const st = await statfs(BACKUP_DIR);
    return st.bfree * st.bsize;
  } catch {
    return null;
  }
}

/**
 * Total size of the backups on disk — for /api/health, because on this volume
 * they are much larger than the data they protect and are the first thing worth
 * looking at when space runs out.
 */
export async function backupBytes(): Promise<number> {
  return (await backupFiles()).reduce((n, f) => n + f.bytes, 0);
}

/**
 * Write TODAY's backup if it isn't there yet — and clean up FIRST, always.
 *
 * THE ORDER IS THE WHOLE POINT. Pruning used to run after the write, so it was
 * downstream of the very thing it made room for: once the disk was too full to
 * write today's backup, the write threw, the prune below it never ran, and
 * nothing was ever deleted again. The disk then stayed full permanently, and
 * because every sale rewrites its store's whole document through a temp file,
 * a full disk means the shop can read but cannot save — it stops trading. That
 * is not hypothetical; it is what took this shop off the air on 2026-08-20,
 * with 14 backups holding several times more space than the live data.
 *
 * Retention is now what FITS, not just a count. A fixed 14 days was sized when a
 * store document was small; each backup holds every store, so it grows with the
 * business while the disk does not. Old ones are dropped until there is room for
 * the new one, never below MIN_KEEP, and every removal is logged so the shrink
 * is visible rather than mysterious.
 */
export async function saveDailyBackup(now: Date): Promise<{ saved: boolean; file?: string; error?: string }> {
  try {
    const dateStr = now.toISOString().slice(0, 10);
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const file = backupFileFor(dateStr);
    // Before anything else, and whatever happens next.
    await pruneOld();
    try {
      await fs.access(file);
      return { saved: false, file };
    } catch {
      /* not there yet — make it below */
    }
    const backup = await buildBackup();
    const text = JSON.stringify(backup);
    // The atomic write puts the whole new file on disk BESIDE the old ones
    // before renaming, so the room needed is the file itself, twice over for
    // the rename window. Make it before writing rather than failing midway.
    const needed = Buffer.byteLength(text) * 2;
    await pruneOld(needed);
    const free = await freeBytes();
    if (free != null && free < needed) {
      // Refuse rather than fill the last of the disk. A missing backup is
      // recoverable; a disk with no room left stops the tills.
      const mb = (n: number) => Math.round(n / 1048576);
      return {
        saved: false,
        error: `not enough disk space for today's backup (needs ~${mb(needed)} MB, ${mb(free)} MB free) — the shop keeps trading, but backups are paused`,
      };
    }
    await writeFileAtomic(file, text);
    return { saved: true, file };
  } catch (e: any) {
    return { saved: false, error: e?.message || String(e) };
  }
}

/**
 * Drop old backups: any beyond the retention window, and then — if `needBytes`
 * is given — as many more as it takes to fit that much on the disk.
 */
async function pruneOld(needBytes = 0): Promise<void> {
  const files = await backupFiles();
  const dropOldest = async (why: string): Promise<boolean> => {
    const oldest = files.shift();
    if (!oldest) return false;
    await fs.unlink(path.join(BACKUP_DIR, oldest.name)).catch(() => {});
    console.log(`[backup] removed ${oldest.name} (${Math.round(oldest.bytes / 1048576)} MB) — ${why}`);
    return true;
  };

  while (files.length > KEEP_DAYS) {
    if (!(await dropOldest("past the retention window"))) return;
  }
  if (!needBytes) return;
  while (files.length > MIN_KEEP) {
    const free = await freeBytes();
    if (free == null || free >= needBytes) return;
    if (!(await dropOldest("making room for today's backup"))) return;
  }
}

/** The auto-backup dates on disk, newest first. */
export async function listAutoBackups(): Promise<string[]> {
  const files = await fs.readdir(BACKUP_DIR).catch(() => []);
  return files
    .map((f) => /^stookii-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
}

/** One auto-backup's JSON text by date, or null if there isn't one. */
export async function readAutoBackup(dateStr: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return fs.readFile(backupFileFor(dateStr), "utf8").catch(() => null);
}
