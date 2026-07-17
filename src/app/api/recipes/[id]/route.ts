import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Recipe } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canManageRecipes, isReadOnly } from "@/lib/access";
import { validateRecipeInput } from "@/lib/recipes";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await getSession();
  if (!session) return { error: "Not signed in", status: 401 };
  if (isReadOnly(session.role) || !canManageRecipes(session.role)) {
    return { error: "Your role can't change recipes.", status: 403 };
  }
  return null;
}

// GET one recipe.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const recipe = db.recipes.find((r) => r.id === params.id);
  if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  return NextResponse.json(recipe);
}

// PUT — replace the recipe's contents.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateDB((db) => {
    const recipe = db.recipes.find((r) => r.id === params.id);
    if (!recipe) return { error: "not_found" as const };

    const parsed = validateRecipeInput(body, db.products);
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = db.recipes.find(
      (r) => r.id !== recipe.id && r.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (clash) return { error: `A recipe called "${clash.name}" already exists.` };

    const before = recipe.items.length;
    Object.assign(recipe, input);
    recipe.updatedBy = actor;
    recipe.updatedAt = new Date().toISOString();

    logAudit(db, {
      actor,
      action: "Updated",
      entityType: "Recipe",
      entity: `${recipe.code} · ${recipe.name}`,
      detail: `${before} → ${recipe.items.length} ingredients · ${recipe.status}`,
    });
    return { recipe };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Recipe not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result.recipe);
}

// POST — duplicate this recipe (a new one is almost always a tweak of an old).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const source = db.recipes.find((r) => r.id === params.id);
    if (!source) return { error: "not_found" as const };

    // "X (copy)", "X (copy 2)" … so duplicating twice doesn't hit the
    // duplicate-name guard and make the button look broken.
    const base = `${source.name} (copy`;
    let name = `${base})`;
    for (let n = 2; db.recipes.some((r) => r.name.toLowerCase() === name.toLowerCase()); n++) {
      name = `${base} ${n})`;
    }

    const seq = db.meta.nextRecipe;
    const copy: Recipe = {
      id: `rcp${seq}`,
      code: `RCP-${seq}`,
      name,
      nameKh: source.nameKh,
      description: source.description,
      image: source.image,
      status: source.status,
      items: source.items.map((i) => ({ ...i })),
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    db.meta.nextRecipe += 1;
    db.recipes.push(copy);

    logAudit(db, {
      actor,
      action: "Duplicated",
      entityType: "Recipe",
      entity: `${copy.code} · ${copy.name}`,
      detail: `copied from ${source.code}`,
    });
    return { recipe: copy };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Recipe not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result.recipe, { status: 201 });
}

// DELETE — remove a recipe outright.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const recipe = db.recipes.find((r) => r.id === params.id);
    if (!recipe) return { error: "not_found" as const };

    // Deleting a recipe a product still sells would silently stop that product
    // deducting anything — the sale keeps working, so nobody would notice until
    // stock drifted. Make them unlink it first, or set the recipe Inactive.
    const linked = db.products.filter((p) => p.recipeId === recipe.id);
    if (linked.length) {
      const names = linked.slice(0, 3).map((p) => p.name).join(", ");
      const more = linked.length > 3 ? ` and ${linked.length - 3} more` : "";
      return {
        error: `${linked.length === 1 ? "1 product still uses" : `${linked.length} products still use`} this recipe (${names}${more}). Unlink ${linked.length === 1 ? "it" : "them"} first, or set the recipe Inactive to pause it.`,
      };
    }

    db.recipes = db.recipes.filter((r) => r.id !== recipe.id);
    logAudit(db, {
      actor,
      action: "Deleted",
      entityType: "Recipe",
      entity: `${recipe.code} · ${recipe.name}`,
      detail: `${recipe.items.length} ingredient${recipe.items.length === 1 ? "" : "s"}`,
    });
    return { ok: true };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Recipe not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result);
}
