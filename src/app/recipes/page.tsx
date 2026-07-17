"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChefHat,
  Plus,
  Trash2,
  Copy,
  Pencil,
  Search,
  AlertTriangle,
  Upload,
  X,
  Utensils,
  Boxes,
  TrendingUp,
} from "lucide-react";
import { api, useFetch, useRole } from "@/lib/client";
import type { Product, Recipe, RecipeItem } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState, ErrorBox, Modal, Badge } from "@/components/ui";
import { Select } from "@/components/Select";
import { SearchSelect } from "@/components/SearchSelect";
import { confirmDialog } from "@/components/confirm";
import { canManageRecipes } from "@/lib/access";
import { usd, pct, num } from "@/lib/format";
import { compatibleUnits, normalizeUnit, unitDimension } from "@/lib/units";
import { recipeCosting, recipeEconomics, stockUnitOf, ingredientAlerts, formatQty } from "@/lib/recipes";
import { isShownOnPos } from "@/lib/pos";

// The form's own shape: quantity stays a STRING while typing so the field can be
// empty or mid-decimal ("0.") without React fighting the cursor. Parsed on save.
type DraftItem = { productId: string; quantity: string; unit: string };
type Draft = {
  id?: string;
  name: string;
  nameKh: string;
  description: string;
  image?: string;
  status: "Active" | "Inactive";
  items: DraftItem[];
  linkedProductIds: string[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  nameKh: "",
  description: "",
  status: "Active",
  items: [],
  linkedProductIds: [],
};

/** What a cook most likely means for an ingredient measured this way. */
function defaultUnitFor(product: Product): string {
  if (product.consumptionUnit && normalizeUnit(product.consumptionUnit)) {
    return normalizeUnit(product.consumptionUnit)!;
  }
  const dim = unitDimension(product.unit);
  // Recipes are written small — grams and millilitres, not kilos and litres.
  if (dim === "weight") return "g";
  if (dim === "volume") return "ml";
  return "pcs";
}

export default function RecipesPage() {
  const { data: recipes, loading, error, reload } = useFetch<Recipe[]>("/api/recipes");
  const { data: products, reload: reloadProducts } = useFetch<Product[]>("/api/products");
  const role = useRole();
  const mayEdit = role ? canManageRecipes(role) : false;

  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const list = recipes || [];
  const catalog = useMemo(() => products || [], [products]);
  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  // Which products each recipe is sold as — the link lives on the product.
  const linkedByRecipe = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of catalog) {
      if (!p.recipeId) continue;
      const arr = map.get(p.recipeId);
      if (arr) arr.push(p);
      else map.set(p.recipeId, [p]);
    }
    return map;
  }, [catalog]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.code.toLowerCase().includes(query) ||
        (r.nameKh || "").includes(q.trim()) ||
        r.items.some((i) => i.name.toLowerCase().includes(query)),
    );
  }, [list, q]);

  const alerts = useMemo(() => ingredientAlerts(list, catalog), [list, catalog]);
  const ingredientCount = useMemo(
    () => new Set(list.flatMap((r) => r.items.map((i) => i.productId))).size,
    [list],
  );

  function startNew() {
    setFormError(null);
    setDraft({ ...EMPTY_DRAFT, items: [] });
  }

  function startEdit(r: Recipe) {
    setFormError(null);
    setDraft({
      id: r.id,
      name: r.name,
      nameKh: r.nameKh || "",
      description: r.description || "",
      image: r.image,
      status: r.status,
      items: r.items.map((i) => ({ productId: i.productId, quantity: String(i.quantity), unit: i.unit })),
      linkedProductIds: (linkedByRecipe.get(r.id) || []).map((p) => p.id),
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setFormError(null);
    try {
      const payload = {
        name: draft.name,
        nameKh: draft.nameKh,
        description: draft.description,
        image: draft.image,
        status: draft.status,
        items: draft.items.map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unit: i.unit,
        })),
      };
      const saved: Recipe = draft.id
        ? await api(`/api/recipes/${draft.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await api("/api/recipes", { method: "POST", body: JSON.stringify(payload) });

      // The recipe→product link lives on the PRODUCT, so applying it is a
      // separate write per product that was added or removed.
      const before = new Set(draft.id ? (linkedByRecipe.get(draft.id) || []).map((p) => p.id) : []);
      const after = new Set(draft.linkedProductIds);
      const toLink = [...after].filter((id) => !before.has(id));
      const toUnlink = [...before].filter((id) => !after.has(id));
      for (const id of toLink) {
        await api(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify({ recipeId: saved.id }) });
      }
      for (const id of toUnlink) {
        await api(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify({ recipeId: "" }) });
      }

      setDraft(null);
      reload();
      reloadProducts();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(r: Recipe) {
    try {
      await api(`/api/recipes/${r.id}`, { method: "POST" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function remove(r: Recipe) {
    const ok = await confirmDialog({
      title: `Delete ${r.name}?`,
      message: "The recipe is removed for good. Sales already rung up keep their record of what was cooked.",
      confirmText: "Delete recipe",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/recipes/${r.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Recipes"
        subtitle="What each made-to-order item is built from. Sell the dish and its ingredients come off stock by themselves."
        actions={
          mayEdit ? (
            <button onClick={startNew} className="btn-primary">
              <Plus size={16} /> New recipe
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Recipes" value={num(list.length)} icon={<ChefHat size={15} />} />
        <StatCard
          label="Active"
          value={num(list.filter((r) => r.status === "Active").length)}
          sub="deducting on every sale"
          icon={<Utensils size={15} />}
          accent="emerald"
        />
        <StatCard
          label="Ingredients tracked"
          value={num(ingredientCount)}
          sub="products used by a recipe"
          icon={<Boxes size={15} />}
          accent="violet"
        />
        <StatCard
          label="Stock alerts"
          value={num(alerts.length)}
          sub={alerts.filter((a) => a.level === "negative").length
            ? `${alerts.filter((a) => a.level === "negative").length} below zero`
            : "ingredients low or negative"}
          icon={<AlertTriangle size={15} />}
          accent={alerts.some((a) => a.level === "negative") ? "rose" : "amber"}
        />
      </div>

      {alerts.length > 0 && (
        <Card className="mb-6" title="Inventory alerts" icon={<AlertTriangle size={15} className="text-amber-500" />}
          subtitle="Ingredients a recipe needs that stock can't cover. Sales were never blocked — this is what they cost.">
          <div className="flex flex-wrap gap-2">
            {alerts.slice(0, 12).map((a) => (
              <span
                key={a.product.id}
                className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold ring-1 ${
                  a.level === "negative"
                    ? "bg-rose-50 text-rose-700 ring-rose-200"
                    : "bg-amber-50 text-amber-700 ring-amber-200"
                }`}
              >
                {a.product.name}
                <span className="font-black tabular-nums">
                  {formatQty(a.product.stock, stockUnitOf(a.product))}
                </span>
              </span>
            ))}
            {alerts.length > 12 && (
              <span className="self-center text-[12px] text-slate-400">+{alerts.length - 12} more</span>
            )}
          </div>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-slate-200">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a recipe or an ingredient inside it…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Loading recipes…" />}

      {!loading && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<ChefHat size={19} />}
            title={q ? "No recipe matches that" : "No recipes yet"}
            hint={
              q
                ? "Try an ingredient name, or the recipe code."
                : "Pick a made-to-order item off your menu and list what goes into it. Sell it at the till and the ingredients come off stock by themselves."
            }
            action={
              !q && mayEdit ? (
                <button onClick={startNew} className="btn-primary">
                  <Plus size={16} /> New recipe
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((r) => (
          <RecipeRow
            key={r.id}
            recipe={r}
            products={catalog}
            linked={linkedByRecipe.get(r.id) || []}
            mayEdit={mayEdit}
            onEdit={() => startEdit(r)}
            onDuplicate={() => duplicate(r)}
            onDelete={() => remove(r)}
          />
        ))}
      </div>

      {draft && (
        <RecipeEditor
          draft={draft}
          setDraft={setDraft}
          products={catalog}
          productById={productById}
          busy={busy}
          error={formError}
          onClose={() => setDraft(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

// --- One recipe in the list -------------------------------------------------

function RecipeRow({
  recipe,
  products,
  linked,
  mayEdit,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  recipe: Recipe;
  products: Product[];
  linked: Product[];
  mayEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const costing = useMemo(() => recipeCosting(recipe, products), [recipe, products]);
  // Margin needs a selling price, and the price lives on the product this is
  // sold as. Unlinked recipes show food cost only — there's nothing to compare.
  const econ = linked[0] ? recipeEconomics(costing.total, linked[0].price) : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          {recipe.image ? (
            <img
              src={`/api/product-image/${recipe.image}`}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
            />
          ) : (
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400">
              <ChefHat size={20} />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold tracking-[-0.01em] text-ink-900">{recipe.name}</p>
              <Badge tone={recipe.status === "Active" ? "emerald" : "slate"}>{recipe.status}</Badge>
              <span className="text-[11.5px] font-semibold text-slate-400">{recipe.code}</span>
            </div>
            {recipe.nameKh && <p className="mt-0.5 text-[13px] text-slate-500">{recipe.nameKh}</p>}
            <p className="mt-1.5 text-[12.5px] text-slate-500">
              {recipe.items.length} ingredient{recipe.items.length === 1 ? "" : "s"}
              {" · "}
              {recipe.items
                .slice(0, 4)
                .map((i) => i.name)
                .join(", ")}
              {recipe.items.length > 4 ? `, +${recipe.items.length - 4} more` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {linked.length === 0 ? (
                <span className="chip bg-amber-100 text-amber-700">Not linked to a product — never deducts</span>
              ) : (
                linked.map((p) => (
                  <span key={p.id} className="chip bg-brand-50 text-brand-700">
                    Sold as {p.name}
                  </span>
                ))
              )}
              {costing.unresolved > 0 && (
                <span className="chip bg-rose-100 text-rose-700">
                  {costing.unresolved} ingredient{costing.unresolved === 1 ? "" : "s"} can&apos;t be costed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Food cost</p>
            <p className="mt-1 text-[19px] font-extrabold tabular-nums leading-none text-ink-900">
              {usd(costing.total)}
            </p>
            {econ && (
              <p className="mt-1.5 text-[12px] text-slate-500">
                sells {usd(econ.price)} ·{" "}
                <span className={econ.margin >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>
                  {pct(econ.margin)} margin
                </span>
              </p>
            )}
          </div>
          {mayEdit && (
            <div className="flex items-center gap-1">
              <button onClick={onEdit} title="Edit" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink-900">
                <Pencil size={16} />
              </button>
              <button onClick={onDuplicate} title="Duplicate" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink-900">
                <Copy size={16} />
              </button>
              <button onClick={onDelete} title="Delete" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** One figure in the cost/margin row — the app's stat-card language, modal-sized. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p
        className={`mt-1.5 text-[19px] font-extrabold tabular-nums leading-none tracking-[-0.02em] ${
          tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// --- Create / edit ----------------------------------------------------------

function RecipeEditor({
  draft,
  setDraft,
  products,
  productById,
  busy,
  error,
  onClose,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  products: Product[];
  productById: Map<string, Product>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  /**
   * Picking the menu item IS naming the recipe — the product already carries
   * the name, the Khmer name and the photo, so asking the cook to type them
   * again is asking them to type something the system knows.
   *
   * Only fills fields that are still empty (or were themselves auto-filled from
   * the product picked before), so a name someone deliberately typed is never
   * overwritten.
   */
  function linkProduct(productId: string) {
    const p = productById.get(productId);
    if (!p) return;
    const previous = draft.linkedProductIds[0] ? productById.get(draft.linkedProductIds[0]) : undefined;
    const derived = (current: string, was: string | undefined) => !current.trim() || current === (was || "");
    const first = draft.linkedProductIds.length === 0;

    setDraft({
      ...draft,
      linkedProductIds: [...draft.linkedProductIds, productId],
      // Only the FIRST product names the recipe — linking a second one that also
      // sells this recipe shouldn't rename it.
      name: first && derived(draft.name, previous?.name) ? p.name : draft.name,
      nameKh: first && derived(draft.nameKh, previous?.nameKh) ? p.nameKh || "" : draft.nameKh,
      image: first && !draft.image ? p.image : draft.image,
    });
  }

  // Ingredient picker: everything in the catalog, already-chosen lines removed
  // so the same product can't be added twice.
  const chosen = new Set(draft.items.map((i) => i.productId));
  const ingredientOptions = useMemo(
    () =>
      products
        .filter((p) => !chosen.has(p.id))
        .map((p) => ({
          value: p.id,
          label: p.name,
          hint: `${p.sku} · ${p.category} · stock ${formatQty(p.stock, stockUnitOf(p))}`,
        })),
    [products, draft.items],
  );

  // "Sold as": the till products this recipe makes. Counter items first — those
  // are what a kitchen actually assembles.
  const linkOptions = useMemo(() => {
    const free = products.filter((p) => !draft.linkedProductIds.includes(p.id));
    const rank = (p: Product) => (isShownOnPos(p) ? 0 : 1);
    return [...free]
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((p) => ({
        value: p.id,
        label: p.name,
        hint: `${p.sku} · ${p.category} · sells ${usd(p.price)}${p.recipeId ? " · already has a recipe" : ""}`,
      }));
  }, [products, draft.linkedProductIds]);

  function addIngredient(productId: string) {
    const p = productById.get(productId);
    if (!p) return;
    set("items", [...draft.items, { productId, quantity: "", unit: defaultUnitFor(p) }]);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    set(
      "items",
      draft.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }

  async function shrink(file: File, max = 512, quality = 0.75): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function pickPhoto(file: File) {
    setUploading(true);
    try {
      const image = await shrink(file);
      const res = await fetch("/api/product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Upload failed");
      setDraft({ ...draft, image: d.name });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

  // Cost the draft exactly the way the server will — same function, so what the
  // form shows is what the sale will book.
  const preview = useMemo(
    () =>
      recipeCosting(
        {
          items: draft.items
            .filter((i) => i.productId && Number(i.quantity) > 0)
            .map((i) => {
              const p = productById.get(i.productId);
              return {
                productId: i.productId,
                sku: p?.sku || "",
                name: p?.name || "",
                quantity: Number(i.quantity),
                unit: i.unit,
              } as RecipeItem;
            }),
        },
        products,
      ),
    [draft.items, products, productById],
  );

  const linkedProducts = draft.linkedProductIds.map((id) => productById.get(id)).filter(Boolean) as Product[];
  const econ = linkedProducts[0] ? recipeEconomics(preview.total, linkedProducts[0].price) : null;
  // A recipe with no ingredients — or ingredients nobody has costed — has no
  // food cost, and "100% margin" would then be a claim that the dish costs
  // nothing to make. Profit and margin stay blank until there's a real cost
  // behind them.
  const costed = preview.total > 0;

  const canSave = draft.name.trim().length > 0 && draft.items.length > 0 && !busy;

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={draft.id ? `Edit ${draft.name || "recipe"}` : "New recipe"}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button onClick={onSave} className="btn-primary" disabled={!canSave}>
            {busy ? "Saving…" : draft.id ? "Save recipe" : "Create recipe"}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <ErrorBox message={error} />}

        {/* Menu item — picked FIRST, because it's what the recipe is for and it
            already carries the name, the Khmer name and the photo. */}
        <div>
          <p className="mb-1 text-sm font-bold text-ink-900">Menu item</p>
          <p className="mb-2 text-[12px] text-slate-400">
            Pick the product the till sells. Its name and photo fill in below — and without one, nothing is ever
            deducted.
          </p>
          {linkedProducts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {linkedProducts.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-brand-700 ring-1 ring-brand-100"
                >
                  {p.image && (
                    <img src={`/api/product-image/${p.image}`} alt="" className="h-5 w-5 rounded object-cover" />
                  )}
                  {p.name} · {usd(p.price)}
                  <button
                    onClick={() => set("linkedProductIds", draft.linkedProductIds.filter((id) => id !== p.id))}
                    className="text-brand-400 transition hover:text-rose-600"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <SearchSelect
            value=""
            options={linkOptions}
            onChange={linkProduct}
            placeholder={
              linkedProducts.length
                ? "+ Another product that sells this same recipe"
                : "Search your products — the menu item this recipe makes"
            }
          />
          {linkedProducts.length === 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-amber-600">
              <AlertTriangle size={13} /> Not linked yet — a recipe with no product never deducts anything.
            </p>
          )}
        </div>

        {/* Identity — pre-filled from the menu item, still editable in case the
            recipe is called something different from what's on the menu. */}
        <div className="flex gap-4">
          <div>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])}
            />
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              title="Change the photo"
              className="group relative grid h-20 w-20 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200 transition hover:ring-brand-300"
            >
              {draft.image ? (
                <img src={`/api/product-image/${draft.image}`} alt="" className="h-full w-full object-cover" />
              ) : uploading ? (
                <span className="text-[10px] font-semibold">Uploading…</span>
              ) : (
                <Upload size={18} />
              )}
            </button>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Recipe name</label>
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Pick a menu item above and this fills in"
                className="input"
              />
            </div>
            <div>
              <label className="label">Khmer name</label>
              <input value={draft.nameKh} onChange={(e) => set("nameKh", e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Status</label>
              <Select
                value={draft.status}
                onChange={(v) => set("status", v as "Active" | "Inactive")}
                options={[
                  { value: "Active", label: "Active", description: "Deducts ingredients on every sale" },
                  { value: "Inactive", label: "Inactive", description: "Kept on file, deducts nothing" },
                ]}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="How it's made, anything the cook should know"
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-ink-900">Ingredients</p>
            <p className="text-[12px] text-slate-400">
              Write the amounts the way you cook — the system converts to stock units.
            </p>
          </div>

          <div className="space-y-2">
            {draft.items.map((item, index) => {
              const p = productById.get(item.productId);
              const line = preview.lines.find((l) => l.item.productId === item.productId);
              const stockUnit = p ? stockUnitOf(p) : "";
              return (
                <div key={item.productId} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-ink-900">{p?.name || "—"}</p>
                      <p className="truncate text-[11.5px] text-slate-400">
                        {p?.sku} · stock {p ? formatQty(p.stock, stockUnit) : "—"} · {usd(p?.cost || 0)}/{stockUnit}
                      </p>
                    </div>
                    <input
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value.replace(/[^\d.]/g, "") })}
                      inputMode="decimal"
                      placeholder="0"
                      className="input w-24 text-right font-semibold tabular-nums"
                    />
                    <div className="w-28">
                      <Select
                        value={item.unit}
                        onChange={(v) => updateItem(index, { unit: v })}
                        options={compatibleUnits(p?.unit).map((u) => ({ value: u.code, label: u.code }))}
                      />
                    </div>
                    <div className="w-20 text-right">
                      <p className="text-[13.5px] font-bold tabular-nums text-ink-900">
                        {line?.cost != null ? usd(line.cost) : "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => set("items", draft.items.filter((_, i) => i !== index))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {line?.problem && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-rose-600">
                      <AlertTriangle size={13} /> {line.problem}
                    </p>
                  )}
                  {line?.qtyInStockUnit != null && item.unit !== stockUnit && (
                    <p className="mt-1.5 text-[11.5px] text-slate-400">
                      = {formatQty(line.qtyInStockUnit, stockUnit)} off stock
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2">
            <SearchSelect
              value=""
              options={ingredientOptions}
              onChange={addIngredient}
              placeholder="+ Add ingredient — search by name, item ID or category"
            />
          </div>
        </div>

        {/* Cost & margin — the same contained-card language as the rest of the
            app, not a feature panel shouting in a different colour. */}
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="mb-3 text-[13px] font-bold text-ink-900">Cost &amp; margin</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Food cost" value={costed ? usd(preview.total) : "—"} />
            <Figure label="Selling price" value={econ ? usd(econ.price) : "—"} />
            <Figure
              label="Gross profit"
              value={costed && econ ? usd(econ.profit) : "—"}
              tone={costed && econ ? (econ.profit >= 0 ? "emerald" : "rose") : undefined}
            />
            <Figure
              label="Margin"
              value={costed && econ ? pct(econ.margin) : "—"}
              tone={costed && econ ? (econ.margin >= 0 ? "emerald" : "rose") : undefined}
            />
          </div>

          {/* Say WHY it's dashes. Showing 100% margin on a recipe with no
              ingredients would claim the dish costs nothing to make. */}
          {!costed && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-[11.5px] text-slate-500">
              {draft.items.length === 0
                ? "Add the ingredients and the food cost, profit and margin work themselves out."
                : "None of these ingredients has a cost yet — set it in Products before the margin means anything."}
            </p>
          )}
          {costed && econ && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-[11.5px] text-slate-500">
              Margin is figured on the ex-VAT price ({usd(econ.netPrice)}) — the same basis as every other margin in
              Stookii. Food cost is {pct(econ.foodCostPct)} of it.
            </p>
          )}
          {preview.unresolved > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-600">
              <AlertTriangle size={13} /> {preview.unresolved} ingredient
              {preview.unresolved === 1 ? "" : "s"} couldn&apos;t be costed — the real cost is higher than this.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
