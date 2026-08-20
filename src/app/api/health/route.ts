import { NextResponse } from "next/server";
import { readBlob, usingPostgres } from "@/lib/blobStore";
import { readSystem } from "@/lib/system";
import { storeFaultReport } from "@/lib/db";
import { listAutoBackups } from "@/lib/backup";
import { statfs } from "fs/promises";
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
  backups: { count: number; newest?: string };
  disk?: { freeMb: number; totalMb: number; usedPct: number };
  error?: string;
};

let cached: { at: number; body: Health } | null = null;
const TTL_MS = 30_000;

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
    health.backups = { count: dates.length, newest: dates[0] };
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
    // A store document is rewritten IN FULL on every sale, so the headroom that
    // matters is several times its size, not a few spare kilobytes.
    if (freeMb < 20) health.ok = false;
  } catch {
    /* not measurable on this platform — not a reason to call the shop unhealthy */
  }
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
