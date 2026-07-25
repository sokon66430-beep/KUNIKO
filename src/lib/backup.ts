import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "./paths";
import { readBlob } from "./blobStore";
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

/**
 * Write TODAY's backup to the persistent disk if it isn't there yet, then prune
 * to the most recent KEEP_DAYS files. Safe to call often — it no-ops once today's
 * file already exists, so it survives restarts and never doubles up.
 */
export async function saveDailyBackup(now: Date): Promise<{ saved: boolean; file?: string; error?: string }> {
  try {
    const dateStr = now.toISOString().slice(0, 10);
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const file = backupFileFor(dateStr);
    try {
      await fs.access(file);
      await pruneOld(); // today's already done — just tidy up
      return { saved: false, file };
    } catch {
      /* not there yet — make it below */
    }
    const backup = await buildBackup();
    await fs.writeFile(file, JSON.stringify(backup), "utf8");
    await pruneOld();
    return { saved: true, file };
  } catch (e: any) {
    return { saved: false, error: e?.message || String(e) };
  }
}

async function pruneOld(): Promise<void> {
  const files = (await fs.readdir(BACKUP_DIR).catch(() => []))
    .filter((f) => /^stookii-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // date-stamped names sort oldest → newest
  for (let i = 0; i < files.length - KEEP_DAYS; i++) {
    await fs.unlink(path.join(BACKUP_DIR, files[i])).catch(() => {});
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
