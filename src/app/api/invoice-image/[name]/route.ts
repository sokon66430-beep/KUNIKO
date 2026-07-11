import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { DATA_DIR } from "@/lib/system";

export const dynamic = "force-dynamic";

// Serve a stored invoice photo. Names are strictly validated (no path parts).
export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const name = params.name;
  if (!/^[A-Za-z0-9._-]+\.jpg$/.test(name)) {
    return NextResponse.json({ error: "Bad name" }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, "invoices", name));
    return new NextResponse(buf as any, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
