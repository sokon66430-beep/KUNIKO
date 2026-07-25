import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canManagePromotions } from "@/lib/access";

export const dynamic = "force-dynamic";

// Store profile = the current store's business meta.
const TEXT_FIELDS = ["name", "address", "phone", "branch", "shipTo", "receivedBy", "authorizedBy"] as const;
const LIST_FIELDS = ["invoiceTo", "poNotes"] as const;

export async function GET() {
  const s = await getSession();
  const db = await readDB();
  const b = db.meta.business;
  // Approver CODES authorize voiding sales and approving cash. The client never
  // needs the code values — the server checks a submitted code — and only the
  // owner edits them in Store Settings. Strip the codes for everyone else so a
  // cashier can't read a manager's code from this endpoint and self-approve.
  if (!s || s.role !== "owner") {
    return NextResponse.json({
      ...b,
      approvers: (b.approvers || []).map((a) => ({ role: a.role, name: a.name })),
    });
  }
  return NextResponse.json(b);
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Only the owner may change the sensitive fields — approver codes (bypass the
  // void/cash approval control), the bank account (redirect deposits) and the VAT
  // rate (changes tax on every sale). Other profile fields stay editable.
  const isOwner = s.role === "owner";
  const body = await req.json().catch(() => ({}));

  const updated = await mutateDB((db) => {
    const b = db.meta.business;
    for (const f of TEXT_FIELDS) {
      if (typeof body[f] === "string") (b as any)[f] = body[f];
    }
    for (const f of LIST_FIELDS) {
      if (Array.isArray(body[f])) (b as any)[f] = body[f].map((x: any) => String(x));
    }
    if (body.vatRate != null && isOwner) b.vatRate = Math.max(0, Number(body.vatRate) || 0);
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
    // Customer Screen — how the T3's second (customer-facing) display is styled.
    if (body.customerDisplay && typeof body.customerDisplay === "object") {
      const c = body.customerDisplay;
      const hex = (v: any, fb: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : fb);
      // Promo images: data-URL images shown as an idle slideshow. Cap the count
      // and each image's size so the store's data file stays a sane size.
      const ads = Array.isArray(c.ads)
        ? c.ads
            .filter((a: any) => typeof a === "string" && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(a) && a.length < 3_000_000)
            .slice(0, 6)
        : [];
      b.customerDisplay = {
        theme: c.theme === "light" ? "light" : "dark",
        brandName: String(c.brandName || "").slice(0, 40),
        accent: hex(c.accent, "#3b82f6"),
        welcomeLine: String(c.welcomeLine || "").slice(0, 80),
        idleSub: String(c.idleSub || "").slice(0, 120),
        thanksTitle: String(c.thanksTitle || "").slice(0, 60),
        thanksSub: String(c.thanksSub || "").slice(0, 60),
        showLogo: c.showLogo !== false,
        showRiel: c.showRiel !== false,
        ads,
        adSeconds: Math.min(30, Math.max(3, Math.round(Number(c.adSeconds) || 6))),
      };
    }
    // Owner-set sidebar order (Menu Layout) — a list of page hrefs.
    if (Array.isArray(body.menuOrder)) {
      b.menuOrder = body.menuOrder.map((x: any) => String(x)).filter(Boolean).slice(0, 100);
    }
    // Full sidebar layout: sections with their ordered hrefs (cross-group moves).
    if (Array.isArray(body.menuLayout)) {
      b.menuLayout = body.menuLayout
        .filter((g: any) => g && typeof g.group === "string" && Array.isArray(g.hrefs))
        .map((g: any) => ({
          group: String(g.group),
          hrefs: g.hrefs.map((h: any) => String(h)).filter(Boolean).slice(0, 100),
        }))
        .slice(0, 20);
    }
    // The one bank account the store deposits cash into (used by Bank Deposit at
    // the till). Name + optional account number; empty name clears it.
    if (body.bankAccount && typeof body.bankAccount === "object" && isOwner) {
      const name = String(body.bankAccount.name || "").trim().slice(0, 60);
      const number = String(body.bankAccount.number || "").trim().slice(0, 40);
      b.bankAccount = name ? { name, number: number || undefined } : undefined;
    }
    // The store cash float — money always kept on hand; a bank transfer deposits
    // only what's ABOVE this. In dollars, never negative.
    if (body.cashFloat != null) {
      b.cashFloat = Math.max(0, Math.round((Number(body.cashFloat) || 0) * 100) / 100);
    }
    if (Array.isArray(body.approvers) && isOwner) {
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
