import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Recipe } from "@/lib/types";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { validateRecipeInput } from "@/lib/recipes";
import { readMaster, readMasterRecipes, mutateMasterRecipes, propagateRecipesToStores } from "@/lib/master";
import { readSystem } from "@/lib/system";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await getSession();
  if (!session) return { error: "Not signed in", status: 401 };
  // Chain-wide change → Master Data (owner / head office) only.
  if (!(await masterDataFor(session.role))) {
    return { error: "Only Master Data (owner / head office) can change recipes.", status: 403 };
  }
  return null;
}

// Write the audit line into the store the actor is working in. The change lands
// in every store, but the trail should read as what a person did and where they
// did it — not as three identical entries nobody performed.
async function audit(actor: string, action: string, recipe: Recipe, detail: string) {
  await mutateDB((db) => {
    logAudit(db, { actor, action, entityType: "Recipe", entity: `${recipe.code} · ${recipe.name}`, detail });
    return true;
  });
}

// GET one recipe — from the store mirror.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDB();
  const recipe = db.recipes.find((r) => r.id === params.id);
  if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  return NextResponse.json(recipe);
}

// PUT — replace the recipe's contents, everywhere.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const body = await req.json().catch(() => ({}));
  const actor = await currentActor();

  const result = await mutateMasterRecipes(async (m) => {
    const recipe = m.items.find((r) => r.id === params.id);
    if (!recipe) return { error: "not_found" as const };

    const products = await readMaster();
    const parsed = validateRecipeInput(body, products);
    if (!parsed.ok) return { error: parsed.error };
    const input = parsed.value;

    const clash = m.items.find((r) => r.id !== recipe.id && r.name.toLowerCase() === input.name.toLowerCase());
    if (clash) return { error: `A recipe called "${clash.name}" already exists.` };

    const before = recipe.items.length;
    Object.assign(recipe, input);
    recipe.updatedBy = actor;
    recipe.updatedAt = new Date().toISOString();
    return { recipe, before };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json({ error: notFound ? "Recipe not found" : result.error }, { status: notFound ? 404 : 400 });
  }

  await propagateRecipesToStores();
  await audit(
    actor,
    "Updated",
    result.recipe,
    `${result.before} → ${result.recipe.items.length} ingredients · ${result.recipe.status} · every store`,
  );
  return NextResponse.json(result.recipe);
}

// POST — duplicate this recipe (a new one is almost always a tweak of an old).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();
  const result = await mutateMasterRecipes((m) => {
    const source = m.items.find((r) => r.id === params.id);
    if (!source) return { error: "not_found" as const };

    // "X (copy)", "X (copy 2)" … so duplicating twice doesn't hit the
    // duplicate-name guard and make the button look broken.
    const base = `${source.name} (copy`;
    let name = `${base})`;
    for (let n = 2; m.items.some((r) => r.name.toLowerCase() === name.toLowerCase()); n++) {
      name = `${base} ${n})`;
    }

    const seq = m.next;
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
    m.next += 1;
    m.items.push(copy);
    return { recipe: copy, from: source.code };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json({ error: notFound ? "Recipe not found" : result.error }, { status: notFound ? 404 : 400 });
  }

  await propagateRecipesToStores();
  await audit(actor, "Duplicated", result.recipe, `copied from ${result.from}`);
  return NextResponse.json(result.recipe, { status: 201 });
}

/**
 * Every store where a product still cooks from this recipe.
 *
 * The recipe is central but the menu LINK is per store, so a shop the deleter
 * isn't standing in can still be using it. Deleting anyway wouldn't break the
 * sale — it would quietly stop deducting ingredients there, which nobody
 * notices until the stock has drifted. So the check spans every store, not just
 * the one whose screen the button was pressed on.
 */
async function storesStillUsing(recipeId: string): Promise<{ store: string; products: string[] }[]> {
  const sys = await readSystem();
  const out: { store: string; products: string[] }[] = [];
  for (const store of sys.stores) {
    try {
      const db = await readDB(store.id);
      const linked = db.products.filter((p) => p.recipeId === recipeId).map((p) => p.name);
      if (linked.length) out.push({ store: store.name, products: linked });
    } catch {
      /* a store that won't load can't be checked — and can't be linked either */
    }
  }
  return out;
}

// DELETE — remove a recipe outright, everywhere.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const actor = await currentActor();

  // Checked BEFORE the master is opened for writing: walking every store while
  // holding the write chain would block every other recipe edit behind it.
  const master = await readMasterRecipes();
  if (!master.items.some((r) => r.id === params.id)) {
    return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  }

  const inUse = await storesStillUsing(params.id);
  if (inUse.length) {
    const total = inUse.reduce((s, u) => s + u.products.length, 0);
    const where = inUse
      .map((u) => `${u.store} (${u.products.slice(0, 2).join(", ")}${u.products.length > 2 ? "…" : ""})`)
      .join("; ");
    return NextResponse.json(
      {
        error: `${total === 1 ? "1 product still uses" : `${total} products still use`} this recipe — ${where}. Unlink ${total === 1 ? "it" : "them"} first, or set the recipe Inactive to pause it.`,
      },
      { status: 400 },
    );
  }

  const result = await mutateMasterRecipes((m) => {
    const recipe = m.items.find((r) => r.id === params.id);
    if (!recipe) return { error: "not_found" as const };
    m.items = m.items.filter((r) => r.id !== recipe.id);
    return { recipe };
  });

  if ("error" in result) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  await propagateRecipesToStores();
  await audit(
    actor,
    "Deleted",
    result.recipe,
    `${result.recipe.items.length} ingredient${result.recipe.items.length === 1 ? "" : "s"} · every store`,
  );
  return NextResponse.json({ ok: true });
}
