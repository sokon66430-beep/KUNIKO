import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canManagePromotions } from "@/lib/access";
import { CHIME_IDS, DEFAULT_CHIME } from "@/lib/chimes";

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
      // Promo images: data-URL images shown as an idle slideshow.
      //
      // The cap matters far more than it looks. These live INSIDE the store
      // document, which is re-serialised and written on every single sale — so
      // an oversized promo image is not a one-off cost, it is added to every
      // transaction for as long as it is set. Measured: at the previous 3 MB ×
      // 6 ceiling a full set took the document to 21 MB and added ~140 ms of
      // stringify+write to EVERY sale, on a 512 MB instance.
      //
      // The uploader already downscales to 1280px JPEG (~300 KB), so 1 MB is
      // generous for anything that came through it, while still catching the
      // two paths that skip downscaling: an SVG, and the decode-failure branch
      // that stores the original file.
      const ads = Array.isArray(c.ads)
        ? c.ads
            .filter((a: any) => typeof a === "string" && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(a) && a.length < 1_000_000)
            .slice(0, 6)
        : [];
      b.customerDisplay = {
        theme: c.theme === "dark" ? "dark" : "light",
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
    // Queue & kitchen behaviour. Owner-only: the reset rule and the block size
    // change the number a customer is holding, so this is not a till setting.
    if (body.queueSettings && typeof body.queueSettings === "object" && s.role === "owner") {
      const q = body.queueSettings;
      // Same reasoning as the promo images above: this sits in the document
      // rewritten on every sale. The picker downscales to 600px, so 1 MB is
      // ample for a logo and still bounds a direct API call.
      const isImg = (v: any) =>
        typeof v === "string" && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(v) && v.length < 1_000_000;
      // Chimes are synthesised from a fixed list, so only a known id is stored —
      // there is no uploaded audio here to size-check or scan.
      const chimeId = (v: any) => (CHIME_IDS.includes(String(v)) ? String(v) : DEFAULT_CHIME);
      // Written out rather than a one-liner: a missing volume must fall back to
      // 80, not to 0. Coercing undefined through `|| 0` would store "silent"
      // and the shop would think the chime never worked.
      const volumePct = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 80;
      };
      // The store's TVs. Ids are re-derived rather than trusted so a crafted id
      // can never end up in a URL we hand back, and the list is capped so the
      // store document can't be grown without bound through this field.
      const screens = Array.isArray(q.screens)
        ? q.screens
            .slice(0, 12)
            .map((s: any, i: number) => ({
              id: String(s?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || `s${i + 1}`,
              name: String(s?.name || `Screen ${i + 1}`).slice(0, 40),
              mode: s?.mode === "split" || s?.mode === "ads" ? s.mode : ("board" as const),
              dark: !!s?.dark,
              rows: Math.min(12, Math.max(1, Math.round(Number(s?.rows) || 7))),
              voice: !!s?.voice,
              // Only a chime we actually ship. An unknown name would leave the
              // screen silently doing nothing, which reads as a broken feature.
              chime: chimeId(s?.chime),
              volume: volumePct(s?.volume),
            }))
            // Two screens sharing an id would both answer to the same link, and
            // the owner would have no way to tell which one they were editing.
            .filter((s: any, i: number, all: any[]) => all.findIndex((x) => x.id === s.id) === i)
        : undefined;
      b.queueSettings = {
        screens,
        maxPerLetter: Math.min(999, Math.max(9, Math.round(Number(q.maxPerLetter) || 99))),
        resetDaily: q.resetDaily !== false,
        voice: !!q.voice,
        voiceLang: String(q.voiceLang || "en-US").slice(0, 12),
        lateAfterMins: Math.min(120, Math.max(1, Math.round(Number(q.lateAfterMins) || 10))),
        // "" clears the picture; anything that isn't a sane data-URL image is
        // dropped rather than stored, so the store file can't fill with junk.
        boardLogo: isImg(q.boardLogo) ? q.boardLogo : undefined,
        accent: /^#[0-9a-fA-F]{6}$/.test(String(q.accent)) ? String(q.accent) : "#2544c7",
        boardNote: String(q.boardNote || "").slice(0, 80),
        chime: chimeId(q.chime),
        volume: volumePct(q.volume),
        numberStyle: ["latin", "mixed", "khmer"].includes(String(q.numberStyle)) ? String(q.numberStyle) : "latin",
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
