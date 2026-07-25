import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

// Owner-only full backup: system (stores + logins) + every store's data, in one
// JSON file the owner can save. Restore it via /api/backup/restore. The same
// buildBackup() also powers the automatic daily backup (see lib/backup.ts).
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const backup = await buildBackup();
  const stamp = backup.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="stookii-backup-${stamp}.json"`,
    },
  });
}
