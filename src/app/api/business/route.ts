import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Store profile = the current store's business meta.
const TEXT_FIELDS = ["name", "address", "phone", "branch", "shipTo", "receivedBy", "authorizedBy"] as const;
const LIST_FIELDS = ["invoiceTo", "poNotes"] as const;

export async function GET() {
  const db = await readDB();
  return NextResponse.json(db.meta.business);
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  const updated = await mutateDB((db) => {
    const b = db.meta.business;
    for (const f of TEXT_FIELDS) {
      if (typeof body[f] === "string") (b as any)[f] = body[f];
    }
    for (const f of LIST_FIELDS) {
      if (Array.isArray(body[f])) (b as any)[f] = body[f].map((x: any) => String(x));
    }
    if (body.vatRate != null) b.vatRate = Math.max(0, Number(body.vatRate) || 0);
    // Logo: a small image data-URL, or "" to clear it. Cap at ~1.5 MB.
    if (typeof body.logo === "string") {
      const ok = body.logo === "" || /^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,/.test(body.logo);
      if (ok && body.logo.length < 2_000_000) b.logo = body.logo || undefined;
    }
    if (Array.isArray(body.approvers)) {
      b.approvers = body.approvers
        .map((a: any) => ({
          role: String(a?.role || "").trim(),
          name: String(a?.name || "").trim(),
          code: String(a?.code || "").trim(),
        }))
        .filter((a: any) => a.role && a.code);
    }
    return b;
  });

  return NextResponse.json(updated);
}
