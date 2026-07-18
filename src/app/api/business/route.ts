import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canManagePromotions } from "@/lib/access";

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
    // How deals are allowed to interact. Kept behind the same permission as
    // creating a promotion — flipping "combine" on changes what every future
    // basket is charged, which is the same margin decision.
    if (body.promotionSettings && typeof body.promotionSettings === "object" && canManagePromotions(s.role)) {
      b.promotionSettings = {
        allowCombine: !!body.promotionSettings.allowCombine,
        allowStackWithMarkdown: !!body.promotionSettings.allowStackWithMarkdown,
      };
    }
    // Invoice Customization — how the customer receipt is styled.
    if (body.receipt && typeof body.receipt === "object") {
      const r = body.receipt;
      const ACCENTS = ["brand", "emerald", "violet", "amber", "rose", "ink"];
      b.receipt = {
        headerNote: String(r.headerNote || "").slice(0, 120),
        footerNote: String(r.footerNote || "").slice(0, 120),
        showLogo: !!r.showLogo,
        showVat: r.showVat !== false,
        showPickup: r.showPickup !== false,
        accent: ACCENTS.includes(r.accent) ? r.accent : "ink",
      };
    }
    if (Array.isArray(body.approvers)) {
      // Role/name/code are all required per row — at most 3 approvers.
      b.approvers = body.approvers
        .map((a: any) => ({
          role: String(a?.role || "").trim(),
          name: String(a?.name || "").trim(),
          code: String(a?.code || "").trim(),
        }))
        .filter((a: any) => a.role && a.name && a.code)
        .slice(0, 3);
    }
    return b;
  });

  return NextResponse.json(updated);
}
