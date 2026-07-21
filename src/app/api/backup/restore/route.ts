import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { writeBlob } from "@/lib/blobStore";
import { invalidateDB } from "@/lib/db";
import { reloadSystem } from "@/lib/system";

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

  // Write through the storage layer (files or Postgres), then drop the in-memory
  // caches so the next read serves the restored data, not the pre-restore copy.
  await writeBlob("system", "system", JSON.stringify(backup.system));
  reloadSystem();
  let restored = 0;
  for (const [id, data] of Object.entries(backup.stores)) {
    // The store id becomes a filename on the file backend — reject anything that
    // isn't a plain slug so a crafted backup can't write outside the stores dir
    // (e.g. an id of "../system" overwriting system.json).
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
    await writeBlob("store", id, JSON.stringify(data));
    invalidateDB(id);
    restored++;
  }

  return NextResponse.json({ ok: true, stores: restored });
}
