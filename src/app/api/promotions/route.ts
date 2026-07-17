import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Promotion } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManagePromotions, isReadOnly } from "@/lib/access";
import { validatePromotionInput, describePromotion } from "@/lib/promotions";
import { readMaster, readMasterPromotions, mutateMasterPromotions, propagatePromotionsToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET /api/promotions — every deal in the chain, highest priority first (the
// order they compete in), then newest.
//
// Reads the MASTER, not the store copy. Deals are managed centrally and can be
// aimed at particular shops, so a store's copy holds only the ones IT runs —
// listing that here would hide every deal belonging to another store from the
// screen you manage them all on.
//
// The till doesn't come through here: the sale route and the preview read
// db.promotions directly, which is exactly the filtered set they should apply.
export async function GET() {
  const master = await readMasterPromotions();
  const list = [...master.items].sort(
    (a, b) => b.priority - a.priority || +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return NextResponse.json(list);
}

// POST /api/promotions — create one, centrally.
//
// A deal is master-owned: written once, mirrored into every store. Its scope is
// checked against the MASTER catalog, because the products it names have to
// exist everywhere it lands, not just where it was written.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isReadOnly(session.role) || !canManagePromotions(session.role)) {
    return NextResponse.json({ error: "Your role can't set up promotions." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateMasterPromotions(async (m) => {
    const products = await readMaster();
    const sys = await readSystem();
    const parsed = validatePromotionInput(body, products, sys.stores.map((s) => s.id));
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = m.items.find((p) => p.name.toLowerCase() === input.name.toLowerCase());
    if (clash) return { error: `A promotion called "${clash.name}" already exists.` };

    const seq = m.next;
    const promo: Promotion = {
      id: `prm${seq}`,
      code: `PRM-${seq}`,
      ...input,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    m.next += 1;
    m.items.push(promo);
    return { promo };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  await propagatePromotionsToStores();
  await mutateDB((db) => {
    logAudit(db, {
      actor,
      action: "Created",
      entityType: "Promotion",
      entity: `${result.promo.code} · ${result.promo.name}`,
      detail: `${describePromotion(result.promo)} · ${result.promo.startDate} to ${result.promo.endDate} · priority ${result.promo.priority} · every store`,
    });
    return true;
  });
  return NextResponse.json(result.promo, { status: 201 });
}
