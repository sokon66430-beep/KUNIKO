"use client";

import { useMemo, useState } from "react";
import { ChefHat, Boxes, TrendingUp, Filter } from "lucide-react";
import { useFetch, useAccess } from "@/lib/client";
import type { Product, Recipe, Sale, StockMovement } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { usd, pct, num } from "@/lib/format";
import { recipeCosting, recipeEconomics, stockUnitOf, formatQty } from "@/lib/recipes";
import { canSeeProfit } from "@/lib/access";
import { storeToday } from "@/lib/markdowns";

type Tab = "consumption" | "sales" | "cost";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "consumption", label: "Ingredient consumption", icon: Boxes },
  { key: "sales", label: "Recipe sales", icon: ChefHat },
  { key: "cost", label: "Food cost", icon: TrendingUp },
];

// Default window: this month to date — the span a manager actually reviews.
function monthStart(): string {
  const today = storeToday();
  return `${today.slice(0, 7)}-01`;
}

export default function RecipeReportsPage() {
  const [tab, setTab] = useState<Tab>("consumption");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(storeToday());
  const [ingredientId, setIngredientId] = useState("All");
  const [recipeId, setRecipeId] = useState("All");

  const { data: movements, loading: mLoading } = useFetch<StockMovement[]>("/api/stock-movements?limit=100000");
  const { data: sales, loading: sLoading } = useFetch<Sale[]>("/api/sales?limit=100000");
  const { data: recipes } = useFetch<Recipe[]>("/api/recipes");
  const { data: products } = useFetch<Product[]>("/api/products");
  const { role, caps } = useAccess();
  const maySeeProfit = role ? canSeeProfit(role, caps) : false;

  const recipeList = recipes || [];
  const catalog = products || [];
  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  // Both reports read the same window, so a day counts the same either way.
  const inRange = (iso: string) => {
    const day = iso.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };

  const filteredMoves = useMemo(
    () =>
      (movements || [])
        .filter((m) => inRange(m.at))
        .filter((m) => ingredientId === "All" || m.productId === ingredientId)
        .filter((m) => recipeId === "All" || m.recipeId === recipeId),
    [movements, from, to, ingredientId, recipeId],
  );

  const filteredSales = useMemo(() => (sales || []).filter((s) => inRange(s.createdAt)), [sales, from, to]);

  // --- Ingredient consumption: how much of each ingredient the kitchen used ---
  const consumption = useMemo(() => {
    const rows = new Map<string, { name: string; sku: string; stockUnit: string; qty: number; cost: number; uses: number }>();
    for (const m of filteredMoves) {
      const row = rows.get(m.productId) || {
        name: m.name,
        sku: m.sku,
        stockUnit: m.stockUnit,
        qty: 0,
        cost: 0,
        uses: 0,
      };
      row.qty += m.qtyDeducted;
      row.cost += m.cost || 0;
      row.uses += 1;
      rows.set(m.productId, row);
    }
    return [...rows.entries()]
      .map(([productId, r]) => ({ productId, ...r, qty: Math.round(r.qty * 1e6) / 1e6 }))
      .sort((a, b) => b.cost - a.cost);
  }, [filteredMoves]);

  // --- Recipe sales: bowls sold and what they consumed ---
  const recipeSales = useMemo(() => {
    const rows = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const s of filteredSales) {
      for (const it of s.items) {
        if (!it.recipeId) continue;
        if (recipeId !== "All" && it.recipeId !== recipeId) continue;
        const row = rows.get(it.recipeId) || { name: it.recipeName || "—", qty: 0, revenue: 0, cost: 0 };
        row.qty += it.qty;
        row.revenue += it.price * it.qty;
        row.cost += it.cost * it.qty;
        rows.set(it.recipeId, row);
      }
    }
    // What each recipe pulled out of stock over the same window.
    const usedBy = new Map<string, Map<string, { name: string; qty: number; stockUnit: string }>>();
    for (const m of filteredMoves) {
      if (!m.recipeId) continue;
      const inner = usedBy.get(m.recipeId) || new Map();
      const cur = inner.get(m.productId) || { name: m.name, qty: 0, stockUnit: m.stockUnit };
      cur.qty += m.qtyDeducted;
      inner.set(m.productId, cur);
      usedBy.set(m.recipeId, inner);
    }
    return [...rows.entries()]
      .map(([id, r]) => ({
        id,
        ...r,
        revenue: Math.round(r.revenue * 100) / 100,
        cost: Math.round(r.cost * 100) / 100,
        ingredients: [...(usedBy.get(id)?.values() || [])].sort((a, b) => b.qty - a.qty),
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [filteredSales, filteredMoves, recipeId]);

  // --- Food cost: what each recipe costs against what it sells for, right now ---
  const foodCost = useMemo(
    () =>
      recipeList
        .filter((r) => recipeId === "All" || r.id === recipeId)
        .map((r) => {
          const costing = recipeCosting(r, catalog);
          const linked = catalog.find((p) => p.recipeId === r.id);
          const econ = linked ? recipeEconomics(costing.total, linked.price) : null;
          return { recipe: r, cost: costing.total, unresolved: costing.unresolved, linked, econ };
        })
        .sort((a, b) => (a.econ?.margin ?? 999) - (b.econ?.margin ?? 999)),
    [recipeList, catalog, recipeId],
  );

  const totalConsumedValue = consumption.reduce((s, r) => s + r.cost, 0);
  const bowlsSold = recipeSales.reduce((s, r) => s + r.qty, 0);
  const recipeRevenue = recipeSales.reduce((s, r) => s + r.revenue, 0);

  // Only ingredients that a recipe actually names — no point offering the whole
  // 4,000-product catalog as a filter.
  const ingredientOptions = useMemo(() => {
    const ids = new Set(recipeList.flatMap((r) => r.items.map((i) => i.productId)));
    return [
      { value: "All", label: "Every ingredient" },
      ...[...ids]
        .map((id) => productById.get(id))
        .filter(Boolean)
        .map((p) => ({ value: p!.id, label: p!.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [recipeList, productById]);

  const loading = mLoading || sLoading;

  return (
    <div>
      <PageHeader
        title="Recipe Reports"
        subtitle="What the kitchen used, what it sold, and what it costs to make."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Bowls sold" value={num(bowlsSold)} sub="made-to-order items" icon={<ChefHat size={15} />} />
        <StatCard
          label="Recipe revenue"
          value={usd(recipeRevenue)}
          sub="in the selected window"
          icon={<TrendingUp size={15} />}
          accent="emerald"
        />
        {maySeeProfit && (
          <StatCard
            label="Ingredients used"
            value={usd(totalConsumedValue)}
            sub="value taken off stock"
            icon={<Boxes size={15} />}
            accent="violet"
          />
        )}
        <StatCard
          label="Deductions"
          value={num(filteredMoves.length)}
          sub="ingredient movements"
          icon={<Filter size={15} />}
          accent="amber"
        />
      </div>

      {/* Filters */}
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div>
            <label className="label">Ingredient</label>
            <Select value={ingredientId} onChange={setIngredientId} options={ingredientOptions} />
          </div>
          <div>
            <label className="label">Recipe</label>
            <Select
              value={recipeId}
              onChange={setRecipeId}
              options={[
                { value: "All", label: "Every recipe" },
                ...recipeList.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                active ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-ink-900"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading && <Spinner label="Loading…" />}

      {!loading && tab === "consumption" && (
        <Card>
          {consumption.length === 0 ? (
            <EmptyState
              title="Nothing consumed in this window"
              hint="Ingredients appear here once a recipe-linked product is sold."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Ingredient</th>
                    <th className="pb-2.5">Item ID</th>
                    <th className="pb-2.5 text-right">Used</th>
                    <th className="pb-2.5 text-right">Times</th>
                    {maySeeProfit && <th className="pb-2.5 text-right">Value</th>}
                    <th className="pb-2.5 text-right">Stock now</th>
                  </tr>
                </thead>
                <tbody>
                  {consumption.map((r) => {
                    const p = productById.get(r.productId);
                    return (
                      <tr key={r.productId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 font-semibold text-ink-900">{r.name}</td>
                        <td className="py-2.5 text-slate-400">{r.sku}</td>
                        <td className="py-2.5 text-right font-bold tabular-nums text-ink-900">
                          {formatQty(r.qty, r.stockUnit)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-slate-500">{num(r.uses)}</td>
                        {maySeeProfit && (
                          <td className="py-2.5 text-right font-semibold tabular-nums text-ink-900">{usd(r.cost)}</td>
                        )}
                        <td
                          className={`py-2.5 text-right font-semibold tabular-nums ${
                            p && p.stock < 0 ? "text-rose-600" : "text-slate-500"
                          }`}
                        >
                          {p ? formatQty(p.stock, stockUnitOf(p)) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loading && tab === "sales" && (
        <div className="space-y-3">
          {recipeSales.length === 0 ? (
            <Card>
              <EmptyState
                title="No recipe sales in this window"
                hint="A sale lands here once the product it sold is linked to a recipe."
              />
            </Card>
          ) : (
            recipeSales.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-ink-900">{r.name}</p>
                    <p className="mt-1 text-[12.5px] text-slate-500">
                      Sold <span className="font-bold text-ink-900">{num(r.qty)}</span>
                      {" · consumed "}
                      {r.ingredients.length
                        ? r.ingredients
                            .map((i) => `${i.name} ${formatQty(i.qty, i.stockUnit)}`)
                            .join(", ")
                        : "nothing recorded"}
                    </p>
                  </div>
                  <div className="flex gap-6 text-right">
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Revenue</p>
                      <p className="mt-1 text-[17px] font-extrabold tabular-nums text-ink-900">{usd(r.revenue)}</p>
                    </div>
                    {maySeeProfit && (
                      <>
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">
                            Food cost
                          </p>
                          <p className="mt-1 text-[17px] font-extrabold tabular-nums text-ink-900">{usd(r.cost)}</p>
                        </div>
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Profit</p>
                          <p className="mt-1 text-[17px] font-extrabold tabular-nums text-emerald-600">
                            {usd(Math.round((r.revenue / 1.1 - r.cost) * 100) / 100)}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {!loading && tab === "cost" && (
        <Card subtitle="Costed from what the ingredients cost today — not what they cost when the recipe was written.">
          {foodCost.length === 0 ? (
            <EmptyState title="No recipes yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                    <th className="pb-2.5">Recipe</th>
                    <th className="pb-2.5">Sold as</th>
                    <th className="pb-2.5 text-right">Food cost</th>
                    <th className="pb-2.5 text-right">Selling price</th>
                    <th className="pb-2.5 text-right">Gross profit</th>
                    <th className="pb-2.5 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {foodCost.map(({ recipe, cost, unresolved, linked, econ }) => (
                    <tr key={recipe.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <span className="font-semibold text-ink-900">{recipe.name}</span>
                        {unresolved > 0 && (
                          <span className="ml-2 chip bg-rose-100 text-rose-700">{unresolved} uncosted</span>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-500">{linked?.name || <span className="text-amber-600">not linked</span>}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-ink-900">{usd(cost)}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">{econ ? usd(econ.price) : "—"}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-ink-900">
                        {econ ? usd(econ.profit) : "—"}
                      </td>
                      <td
                        className={`py-2.5 text-right font-bold tabular-nums ${
                          !econ ? "text-slate-400" : econ.margin >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {econ ? pct(econ.margin) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
