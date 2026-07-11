import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { DATA_DIR, STORES_DIR } from "@/lib/system";

export const dynamic = "force-dynamic";

// Owner-only restore: replaces system + store files with a backup JSON.
// Destructive — the UI confirms before calling this.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") {
    return NextResponse.json({ error: "Owners only" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No backup file uploaded" }, { status: 400 });
  }

  let backup: any;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: "That file isn't a valid backup (bad JSON)" }, { status: 400 });
  }
  if (!backup?.system?.stores || !backup?.system?.users || !backup?.stores) {
    return NextResponse.json({ error: "That doesn't look like a Stookii backup" }, { status: 400 });
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "system.json"), JSON.stringify(backup.system, null, 2), "utf8");
  await fs.mkdir(STORES_DIR, { recursive: true });
  let restored = 0;
  for (const [id, data] of Object.entries(backup.stores)) {
    await fs.writeFile(path.join(STORES_DIR, `${id}.json`), JSON.stringify(data, null, 2), "utf8");
    restored++;
  }

  return NextResponse.json({ ok: true, stores: restored });
}
