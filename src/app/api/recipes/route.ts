import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Recipe } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManageRecipes, isReadOnly } from "@/lib/access";
import { validateRecipeInput } from "@/lib/recipes";
import { readMaster, mutateMasterRecipes, propagateRecipesToStores } from "@/lib/master";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET /api/recipes — every recipe, newest first.
//
// Read from the STORE, not the master: the store copy is an exact mirror, and
// the till and the reports read it on the hot path.
export async function GET() {
  const db = await readDB();
  const list = [...db.recipes].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json(list);
}

// POST /api/recipes — create one, centrally.
//
// A recipe is master-owned: written once, mirrored into every store, so a chain
// doesn't key the same bowl three times. Ingredients are checked against the
// MASTER catalog for the same reason — the recipe has to be valid everywhere it
// lands, not just in the shop that happened to write it.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isReadOnly(session.role) || !canManageRecipes(session.role)) {
    return NextResponse.json({ error: "Your role can't change recipes." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateMasterRecipes(async (m) => {
    const products = await readMaster();
    const parsed = validateRecipeInput(body, products);
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    // Two recipes with the same name are a data-entry slip, not a use case —
    // and they'd be impossible to tell apart in the product's recipe picker.
    const clash = m.items.find((r) => r.name.toLowerCase() === input.name.toLowerCase());
    if (clash) return { error: `A recipe called "${clash.name}" already exists.` };

    const seq = m.next;
    const recipe: Recipe = {
      id: `rcp${seq}`,
      code: `RCP-${seq}`,
      ...input,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    m.next += 1;
    m.items.push(recipe);
    return { recipe };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  await propagateRecipesToStores();
  await mutateDB((db) => {
    logAudit(db, {
      actor,
      action: "Created",
      entityType: "Recipe",
      entity: `${result.recipe.code} · ${result.recipe.name}`,
      detail: `${result.recipe.items.length} ingredient${result.recipe.items.length === 1 ? "" : "s"} · every store`,
    });
    return true;
  });
  return NextResponse.json(result.recipe, { status: 201 });
}
