import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canManagePromotions, isReadOnly } from "@/lib/access";
import { validatePromotionInput, describePromotion } from "@/lib/promotions";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await getSession();
  if (!session) return { error: "Not signed in", status: 401 };
  if (isReadOnly(session.role) || !canManagePromotions(session.role)) {
    return { error: "Your role can't set up promotions.", status: 403 };
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const promo = db.promotions.find((p) => p.id === params.id);
  if (!promo) return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  return NextResponse.json(promo);
}

// PUT — replace the deal's terms.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const promo = db.promotions.find((p) => p.id === params.id);
    if (!promo) return { error: "not_found" as const };

    const parsed = validatePromotionInput(body, db.products);
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = db.promotions.find(
      (p) => p.id !== promo.id && p.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (clash) return { error: `A promotion called "${clash.name}" already exists.` };

    Object.assign(promo, input);
    promo.updatedBy = actor;
    promo.updatedAt = new Date().toISOString();

    logAudit(db, {
      actor,
      action: "Updated",
      entityType: "Promotion",
      entity: `${promo.code} · ${promo.name}`,
      detail: `${describePromotion(promo)} · ${promo.status} · priority ${promo.priority}`,
    });
    return { promo };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Promotion not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result.promo);
}

// DELETE — remove a promotion.
//
// Unlike a markdown label (whose code past sales still have to resolve), a
// promotion leaves nothing behind that needs looking up: every usage row
// snapshots the deal's name and terms, so the reports survive the delete.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const promo = db.promotions.find((p) => p.id === params.id);
    if (!promo) return { error: "not_found" as const };

    const used = db.promotionUsages.filter((u) => u.promotionId === promo.id).length;
    db.promotions = db.promotions.filter((p) => p.id !== promo.id);

    logAudit(db, {
      actor,
      action: "Deleted",
      entityType: "Promotion",
      entity: `${promo.code} · ${promo.name}`,
      detail: used ? `had run ${used} time${used === 1 ? "" : "s"} — history kept` : "never used",
    });
    return { ok: true, keptHistory: used };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Promotion not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result);
}
