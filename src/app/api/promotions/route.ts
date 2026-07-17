import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Promotion } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManagePromotions, isReadOnly } from "@/lib/access";
import { validatePromotionInput, describePromotion } from "@/lib/promotions";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET /api/promotions — every deal, highest priority first (the order they
// compete in), then newest.
export async function GET() {
  const db = await readDB();
  const list = [...db.promotions].sort(
    (a, b) => b.priority - a.priority || +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return NextResponse.json(list);
}

// POST /api/promotions — create one.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isReadOnly(session.role) || !canManagePromotions(session.role)) {
    return NextResponse.json({ error: "Your role can't set up promotions." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const parsed = validatePromotionInput(body, db.products);
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = db.promotions.find((p) => p.name.toLowerCase() === input.name.toLowerCase());
    if (clash) return { error: `A promotion called "${clash.name}" already exists.` };

    const seq = db.meta.nextPromotion;
    const promo: Promotion = {
      id: `prm${seq}`,
      code: `PRM-${seq}`,
      ...input,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    db.meta.nextPromotion += 1;
    db.promotions.push(promo);

    logAudit(db, {
      actor,
      action: "Created",
      entityType: "Promotion",
      entity: `${promo.code} · ${promo.name}`,
      detail: `${describePromotion(promo)} · ${promo.startDate} to ${promo.endDate} · priority ${promo.priority}`,
    });
    return { promo };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.promo, { status: 201 });
}
