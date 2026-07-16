import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { DATA_DIR } from "@/lib/system";

export const dynamic = "force-dynamic";

// Store a PRODUCT photo (the picture shown on the POS tile) and return the file
// name to save on Product.image. Owner-only — products are managed in Master
// Data. Kept in its own folder, separate from the supplier-invoice photos.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const url = typeof body.image === "string" ? body.image : "";
  const m = url.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return NextResponse.json({ error: "An image is required" }, { status: 400 });

  const buf = Buffer.from(m[2], "base64");
  // The editor downscales before upload, so anything big is a mistake.
  if (buf.length > 2_000_000) {
    return NextResponse.json({ error: "Image is too large (max 2 MB)." }, { status: 400 });
  }

  const name = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  try {
    await fs.mkdir(path.join(DATA_DIR, "products"), { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "products", name), buf);
  } catch {
    return NextResponse.json({ error: "Could not save the image." }, { status: 500 });
  }
  return NextResponse.json({ name }, { status: 201 });
}
