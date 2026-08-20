import { NextResponse } from "next/server";
import { readBlob, usingPostgres } from "@/lib/blobStore";
import { readSystem } from "@/lib/system";
import { storeFaultReport } from "@/lib/db";
import { listAutoBackups, backupBytes } from "@/lib/backup";
import { statfs, stat, readdir } from "fs/promises";
import { join } from "path";
import { DATA_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * Is the shop's data readable? — answerable WITHOUT signing in.
 *
 * This exists because of how the app fails. Sign-in reads the small system
 * document; every actual screen reads the store's big one. When the store
 * document is unreadable the login page still works perfectly and everything
 * past it returns a bare 500, so from outside the shop looks up while nobody can
 * sell. There was no way to tell those two apart without a shell on the server.
 *
 * PUBLIC ON PURPOSE. A health check behind the login cannot answer the one
 * question worth asking — "can anyone get in and work?" — because reaching it
 * already assumes the answer. So it reports only condition: which stores exist
 * by id, whether their data parses, how big it is, and when backups were last
 * taken. No products, no prices, no takings, no names, no logins.
 *
 * Answers are held for 30 seconds. Checking means reading every store document,
 * and this shop runs on one small instance where the till shares the process —
 * an unauthenticated endpoint that re-reads megabytes on every hit would be a
 * way to stop trading rather than a way to measure it.
 */

type Health = {
  ok: boolean;
  checkedAt: string;
  backend: "postgres" | "files";
  commit?: string;
  stores: Array<{ id: string; present: boolean; parses: boolean; bytes: number; error?: string }>;
  faults: ReturnType<typeof storeFaultReport>;
  backups: { count: number; newest?: string; mb?: number };
  disk?: { freeMb: number; totalMb: number; usedPct: number; needMb?: number };
  dataMb?: Record<string, number>;
  error?: string;
};

let cached: { at: number; body: Health } | null = null;
const TTL_MS = 30_000;

/**
 * Megabytes under each top-level entry of the data disk.
 *
 * "98% full" is not actionable on its own — it says stop, not what to remove.
 * When this volume filled, the backups and the store files together accounted
 * for barely half of what was used, and there was no way to find the rest
 * without a shell. So the check names the folders and their sizes.
 *
 * Walking is capped: invoice photos are many small files, and an
 * unauthenticated endpoint that stats tens of thousands of them on a shared
 * process would itself become the outage. Past the cap the figure is a floor,
 * which is enough to identify the culprit.
 */
async function dataUsage(): Promise<Record<string, number>> {
  const MAX_FILES = 20_000;
  let seen = 0;
  const sizeOf = async (p: string): Promise<number> => {
    if (seen >= MAX_FILES) return 0;
    const st = await stat(p).catch(() => null);
    if (!st) return 0;
    if (st.isFile()) {
      seen++;
      return st.size;
    }
    if (!st.isDirectory()) return 0;
    const names = await readdir(p).catch(() => []);
    let total = 0;
    for (const n of names) total += await sizeOf(join(p, n));
    return total;
  };
  const out: Record<string, number> = {};
  for (const name of await readdir(DATA_DIR).catch(() => [])) {
    const mb = Math.round((await sizeOf(join(DATA_DIR, name))) / 1048576);
    if (mb > 0) out[name] = mb;
  }
  return out;
}

async function check(): Promise<Health> {
  const health: Health = {
    ok: true,
    checkedAt: new Date().toISOString(),
    backend: usingPostgres() ? "postgres" : "files",
    // Render sets this on every deploy — it is how you confirm which build is
    // actually live, rather than guessing from asset names.
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
    stores: [],
    faults: storeFaultReport(),
    backups: { count: 0 },
  };

  try {
    const sys = await readSystem();
    for (const st of sys.stores) {
      const entry = { id: st.id, present: false, parses: false, bytes: 0 } as Health["stores"][number];
      try {
        const raw = await readBlob("store", st.id);
        if (raw == null) {
          // A store with no document yet is normal (it seeds on first use), so
          // this is reported rather than counted as a fault.
          health.stores.push(entry);
          continue;
        }
        entry.present = true;
        entry.bytes = raw.length;
        JSON.parse(raw);
        entry.parses = true;
      } catch (e: any) {
        entry.error = e?.message || String(e);
        health.ok = false;
      }
      health.stores.push(entry);
    }
  } catch (e: any) {
    // The system document itself is unreadable — nobody can even sign in.
    health.ok = false;
    health.error = e?.message || String(e);
  }

  try {
    const dates = await listAutoBackups();
    // Their SIZE, not just their dates: each backup holds every store, so on
    // this volume they outgrow the data they protect and are the first thing to
    // look at when the disk fills.
    health.backups = {
      count: dates.length,
      newest: dates[0],
      mb: Math.round((await backupBytes()) / 1048576),
    };
  } catch {
    /* the backup folder is not part of whether the shop can trade */
  }

  // A FULL DISK is the other way this shop stops. Reads keep working, so every
  // screen looks fine, but the atomic write has nowhere to put its temp file —
  // so every sale, every receipt, every count fails to save. That reads to a
  // cashier as "it won't let me sell" with nothing obviously broken, and it is
  // invisible from outside unless something measures it.
  try {
    const st = await statfs(DATA_DIR);
    const totalMb = Math.round((st.blocks * st.bsize) / 1048576);
    const freeMb = Math.round((st.bfree * st.bsize) / 1048576);
    const usedPct = totalMb > 0 ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0;
    health.disk = { freeMb, totalMb, usedPct };
    // The headroom that matters is measured against the BIGGEST store document,
    // because one sale rewrites one whole document through a temp file beside
    // it — so the shop needs room for two copies of its largest store before it
    // can take money, no matter how healthy a percentage looks. A fixed figure
    // was wrong for exactly this reason: 20 MB free reads as "nearly full but
    // fine" next to a 23 MB store that cannot save a single sale.
    const biggestMb = Math.max(0, ...health.stores.map((s) => s.bytes / 1048576));
    health.disk.needMb = Math.max(50, Math.ceil(biggestMb * 2));
    if (freeMb < health.disk.needMb) health.ok = false;
  } catch {
    /* not measurable on this platform — not a reason to call the shop unhealthy */
  }
  health.dataMb = await dataUsage();
  if (Object.keys(health.faults).length > 0) health.ok = false;
  return health;
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) {
    cached = { at: now, body: await check() };
  }
  // 503 when the shop cannot trade, so an uptime monitor sees it too.
  return NextResponse.json(cached.body, {
    status: cached.body.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
