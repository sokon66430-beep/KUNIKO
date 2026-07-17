import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Promotion } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManagePromotions, isReadOnly } from "@/lib/access";
import { validatePromotionInput, describePromotion } from "@/lib/promotions";
import { readMaster, mutateMasterPromotions, propagatePromotionsToStores } from "@/lib/master";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET /api/promotions — every deal, highest priority first (the order they
// compete in), then newest.
//
// Read from the STORE, not the master: the store copy is an exact mirror, and
// the till has to resolve a deal while a customer is standing there.
export async function GET() {
  const db = await readDB();
  const list = [...db.promotions].sort(
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
    const parsed = validatePromotionInput(body, products);
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
