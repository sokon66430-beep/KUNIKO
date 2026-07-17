import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Promotion } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManagePromotions, isReadOnly } from "@/lib/access";
import { validatePromotionInput, describePromotion } from "@/lib/promotions";
import { readMaster, mutateMasterPromotions, propagatePromotionsToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";
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

// The change lands in every store, but the audit line goes where the person was
// standing — three identical entries nobody performed is worse than one true one.
async function audit(actor: string, action: string, promo: Promotion, detail: string) {
  await mutateDB((db) => {
    logAudit(db, { actor, action, entityType: "Promotion", entity: `${promo.code} · ${promo.name}`, detail });
    return true;
  });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const promo = db.promotions.find((p) => p.id === params.id);
  if (!promo) return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  return NextResponse.json(promo);
}

// PUT — replace the deal's terms, everywhere.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateMasterPromotions(async (m) => {
    const promo = m.items.find((p) => p.id === params.id);
    if (!promo) return { error: "not_found" as const };

    const products = await readMaster();
    const sys = await readSystem();
    const parsed = validatePromotionInput(body, products, sys.stores.map((s) => s.id));
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = m.items.find((p) => p.id !== promo.id && p.name.toLowerCase() === input.name.toLowerCase());
    if (clash) return { error: `A promotion called "${clash.name}" already exists.` };

    Object.assign(promo, input);
    promo.updatedBy = actor;
    promo.updatedAt = new Date().toISOString();
    return { promo };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json({ error: notFound ? "Promotion not found" : result.error }, { status: notFound ? 404 : 400 });
  }

  await propagatePromotionsToStores();
  await audit(
    actor,
    "Updated",
    result.promo,
    `${describePromotion(result.promo)} · ${result.promo.status} · priority ${result.promo.priority} · every store`,
  );
  return NextResponse.json(result.promo);
}

/** How many times this deal has fired, counted across every store. */
async function timesUsed(promotionId: string): Promise<number> {
  const sys = await readSystem();
  let used = 0;
  for (const store of sys.stores) {
    try {
      const db = await readDB(store.id);
      used += (db.promotionUsages || []).filter((u) => u.promotionId === promotionId).length;
    } catch {
      /* a store that won't load can't be counted */
    }
  }
  return used;
}

// DELETE — remove a promotion, everywhere.
//
// Unlike a markdown label (whose code past sales still have to resolve), a
// promotion leaves nothing behind that needs looking up: every usage row
// snapshots the deal's name and terms, so the reports survive the delete.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();
  const used = await timesUsed(params.id);

  const result = await mutateMasterPromotions((m) => {
    const promo = m.items.find((p) => p.id === params.id);
    if (!promo) return { error: "not_found" as const };
    m.items = m.items.filter((p) => p.id !== promo.id);
    return { promo };
  });

  if ("error" in result) return NextResponse.json({ error: "Promotion not found" }, { status: 404 });

  await propagatePromotionsToStores();
  await audit(
    actor,
    "Deleted",
    result.promo,
    used ? `had run ${used} time${used === 1 ? "" : "s"} — history kept · every store` : "never used · every store",
  );
  return NextResponse.json({ ok: true, keptHistory: used });
}
