import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listAutoBackups, readAutoBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

// Owner-only: list the automatic daily backups the server keeps on disk, or
// pass ?date=YYYY-MM-DD to download that day's backup file.
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date");
  if (date) {
    const raw = await readAutoBackup(date);
    if (raw == null) {
      return NextResponse.json({ error: "No automatic backup for that date" }, { status: 404 });
    }
    return new NextResponse(raw, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="stookii-backup-${date}.json"`,
      },
    });
  }

  return NextResponse.json({ dates: await listAutoBackups() });
}
