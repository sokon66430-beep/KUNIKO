import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { readSystem, STORES_DIR } from "@/lib/system";

export const dynamic = "force-dynamic";

// Owner-only full backup: system (stores + logins) + every store's data, in one
// JSON file the owner can save. Restore it via /api/backup/restore.
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const sys = await readSystem();
  const stores: Record<string, unknown> = {};
  for (const st of sys.stores) {
    try {
      const raw = await fs.readFile(path.join(STORES_DIR, `${st.id}.json`), "utf8");
      stores[st.id] = JSON.parse(raw);
    } catch {
      /* store file not created yet — skip */
    }
  }

  const backup = { version: 1, exportedAt: new Date().toISOString(), system: sys, stores };
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="stookii-backup-${stamp}.json"`,
    },
  });
}
