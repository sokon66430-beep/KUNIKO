"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  Search,
  Clock,
  X,
  Layers,
  Gift,
  AlertTriangle,
  Check,
  Store as StoreIcon,
} from "lucide-react";
import { api, useFetch, useRole } from "@/lib/client";
import type { Product, Promotion, PromotionScope, PromotionType, Supplier, PromotionSettings } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState, ErrorBox, Modal, Badge } from "@/components/ui";
import { Select } from "@/components/Select";
import { SearchSelect } from "@/components/SearchSelect";
import { DatePicker } from "@/components/DatePicker";
import { confirmDialog } from "@/components/confirm";
import { canManagePromotions } from "@/lib/access";
import { usd, num } from "@/lib/format";
import { storeToday } from "@/lib/storetime";
import {
  PROMOTION_TYPE_LABEL,
  describePromotion,
  describeScope,
  promotionState,
  scopeSize,
  type PromotionState,
} from "@/lib/promotions";

// Only what the picker needs. /api/stores returns more, but a deal cares about
// nothing beyond which shop is which.
type StoreRow = { id: string; name: string };

type Draft = {
  id?: string;
  name: string;
  type: PromotionType;
  scopeKind: "products" | "category" | "supplier";
  productIds: string[];
  categories: string[];
  supplierCodes: string[];
  buyQty: string;
  freeQty: string;
  discountAmount: string;
  discountPercent: string;
  bundlePrice: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  status: "Active" | "Paused";
  priority: string;
  // Which shops run it. `allStores` is kept separate from the list so that
  // switching to "some stores" and back doesn't lose the picks — and so an
  // empty list can't be mistaken for "everywhere".
  allStores: boolean;
  storeIds: string[];
};

function emptyDraft(): Draft {
  const today = storeToday();
  return {
    name: "",
    type: "BUY_X_GET_Y_FREE",
    scopeKind: "products",
    productIds: [],
    categories: [],
    supplierCodes: [],
    buyQty: "2",
    freeQty: "1",
    discountAmount: "",
    discountPercent: "",
    bundlePrice: "",
    startDate: today,
    endDate: today,
    startTime: "",
    endTime: "",
    status: "Active",
    // 50 leaves room to slot deals both above and below without renumbering.
    priority: "50",
    allStores: true,
    storeIds: [],
  };
}

const STATE_TONE: Record<PromotionState, "emerald" | "brand" | "slate" | "amber"> = {
  Live: "emerald",
  Scheduled: "brand",
  Ended: "slate",
  Paused: "slate",
  "Outside hours": "amber",
};

/**
 * The promotions screen.
 *
 * Lives here rather than in a page because Master Data owns deals now and mounts
 * this as a tab. `embedded` drops the page title — inside Master Data the page
 * already has one, and two headers stacked reads as a mistake.
 */
export default function PromotionsManager({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: promotions, loading, error, reload } = useFetch<Promotion[]>("/api/promotions");
  const { data: products } = useFetch<Product[]>("/api/products");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  // Every store the signed-in user can see — an owner sees them all, which is
  // who manages deals.
  const { data: stores } = useFetch<StoreRow[]>("/api/stores");
  const { data: business, reload: reloadBusiness } = useFetch<{ promotionSettings?: PromotionSettings }>("/api/business");
  const role = useRole();
  const mayEdit = role ? canManagePromotions(role) : false;

  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const list = promotions || [];
  const catalog = useMemo(() => products || [], [products]);
  const today = storeToday();

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query),
    );
  }, [list, q]);

  const liveCount = list.filter((p) => promotionState(p, today) === "Live").length;
  const settings = business?.promotionSettings || { allowCombine: false, allowStackWithMarkdown: false };

  function startNew() {
    setFormError(null);
    setDraft(emptyDraft());
  }

  function startEdit(p: Promotion) {
    setFormError(null);
    setDraft({
      id: p.id,
      name: p.name,
      type: p.type,
      scopeKind: p.scope.kind,
      productIds: p.scope.kind === "products" ? p.scope.productIds : [],
      categories: p.scope.kind === "category" ? p.scope.categories : [],
      supplierCodes: p.scope.kind === "supplier" ? p.scope.supplierCodes : [],
      buyQty: String(p.buyQty),
      freeQty: p.freeQty != null ? String(p.freeQty) : "",
      discountAmount: p.discountAmount != null ? String(p.discountAmount) : "",
      discountPercent: p.discountPercent != null ? String(p.discountPercent) : "",
      bundlePrice: p.bundlePrice != null ? String(p.bundlePrice) : "",
      startDate: p.startDate,
      endDate: p.endDate,
      startTime: p.startTime || "",
      endTime: p.endTime || "",
      status: p.status,
      priority: String(p.priority),
      // No storeIds on the record means every store — including deals written
      // before a deal could be aimed at one.
      allStores: !p.storeIds || p.storeIds.length === 0,
      storeIds: p.storeIds || [],
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setFormError(null);
    try {
      const scope: PromotionScope =
        draft.scopeKind === "category"
          ? { kind: "category", categories: draft.categories }
          : draft.scopeKind === "supplier"
            ? { kind: "supplier", supplierCodes: draft.supplierCodes }
            : { kind: "products", productIds: draft.productIds };

      const payload = {
        name: draft.name,
        type: draft.type,
        scope,
        buyQty: Number(draft.buyQty),
        freeQty: draft.freeQty ? Number(draft.freeQty) : undefined,
        discountAmount: draft.discountAmount ? Number(draft.discountAmount) : undefined,
        discountPercent: draft.discountPercent ? Number(draft.discountPercent) : undefined,
        bundlePrice: draft.bundlePrice ? Number(draft.bundlePrice) : undefined,
        startDate: draft.startDate,
        endDate: draft.endDate,
        startTime: draft.startTime,
        endTime: draft.endTime,
        status: draft.status,
        priority: Number(draft.priority),
        // Omitted entirely for every store, so the deal also covers a shop
        // opened after it was written. The server rejects an empty list rather
        // than reading it as "everywhere".
        storeIds: draft.allStores ? undefined : draft.storeIds,
      };
      if (draft.id) await api(`/api/promotions/${draft.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/promotions", { method: "POST", body: JSON.stringify(payload) });
      setDraft(null);
      reload();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Promotion) {
    const ok = await confirmDialog({
      title: `Delete ${p.name}?`,
      message: "It stops applying immediately. Sales that already used it keep their record of what was given.",
      confirmText: "Delete promotion",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/promotions/${p.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function saveSettings(next: PromotionSettings) {
    try {
      await api("/api/business", { method: "PATCH", body: JSON.stringify({ promotionSettings: next }) });
      reloadBusiness();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      {embedded ? (
        mayEdit && (
          <div className="mb-4 flex justify-end">
            <button onClick={startNew} className="btn-primary">
              <Plus size={16} /> New promotion
            </button>
          </div>
        )
      ) : (
        <PageHeader
          title="Promotions"
          subtitle="Deals the till works out by itself. The cashier scans — nothing here is applied by hand."
          actions={
            mayEdit ? (
              <button onClick={startNew} className="btn-primary">
                <Plus size={16} /> New promotion
              </button>
            ) : null
          }
        />
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Promotions" value={num(list.length)} icon={<Sparkles size={15} />} />
        <StatCard
          label="Running now"
          value={num(liveCount)}
          sub="applying to baskets"
          icon={<Gift size={15} />}
          accent="emerald"
        />
        <StatCard
          label="Scheduled"
          value={num(list.filter((p) => promotionState(p, today) === "Scheduled").length)}
          sub="not started yet"
          icon={<Clock size={15} />}
          accent="violet"
        />
        <StatCard
          label="Paused / ended"
          value={num(list.filter((p) => ["Paused", "Ended"].includes(promotionState(p, today))).length)}
          icon={<Layers size={15} />}
          accent="amber"
        />
      </div>

      {/* How deals interact — the two rules that change every basket. */}
      <Card
        className="mb-6"
        title="How promotions combine"
        icon={<Layers size={15} className="text-slate-400" />}
        subtitle="Both off means a customer gets the single best deal on any item, never two at once."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            label="Combine promotions"
            hint="Let a second deal also use items a first deal already counted."
            checked={settings.allowCombine}
            disabled={!mayEdit}
            onChange={(v) => saveSettings({ ...settings, allowCombine: v })}
          />
          <Toggle
            label="Stack on marked-down items"
            hint="Let deals apply on top of a reduced-to-clear price."
            checked={settings.allowStackWithMarkdown}
            disabled={!mayEdit}
            onChange={(v) => saveSettings({ ...settings, allowStackWithMarkdown: v })}
          />
        </div>
      </Card>

      <div className="mb-4 flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-slate-200">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a promotion by name or code…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Loading promotions…" />}

      {!loading && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<Sparkles size={19} />}
            title={q ? "No promotion matches that" : "No promotions yet"}
            hint={
              q
                ? "Try the promotion's name or its code."
                : "Set up a deal — buy 2 get 1 free, a bundle price, money or a percentage off — and the till starts applying it by itself the moment it's live."
            }
            action={
              !q && mayEdit ? (
                <button onClick={startNew} className="btn-primary">
                  <Plus size={16} /> New promotion
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((p) => (
          <PromotionRow
            key={p.id}
            promo={p}
            products={catalog}
            stores={stores || []}
            today={today}
            mayEdit={mayEdit}
            onEdit={() => startEdit(p)}
            onDelete={() => remove(p)}
          />
        ))}
      </div>

      {draft && (
        <PromotionEditor
          draft={draft}
          setDraft={setDraft}
          products={catalog}
          suppliers={suppliers || []}
          stores={stores || []}
          busy={busy}
          error={formError}
          onClose={() => setDraft(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-xl px-3 py-3 text-left ring-1 transition ${
        checked ? "bg-brand-50/60 ring-brand-200" : "bg-slate-50 ring-slate-200"
      } ${disabled ? "cursor-not-allowed opacity-60" : "hover:ring-slate-300"}`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 transition ${
          checked ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-300"
        }`}
      >
        {checked && <span className="text-[11px] font-black leading-none">✓</span>}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-ink-900">{label}</span>
        <span className="block text-[11.5px] leading-relaxed text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

function PromotionRow({
  promo,
  products,
  stores,
  today,
  mayEdit,
  onEdit,
  onDelete,
}: {
  promo: Promotion;
  products: Product[];
  stores: StoreRow[];
  today: string;
  mayEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const state = promotionState(promo, today);
  const covers = useMemo(() => scopeSize(promo.scope, products), [promo.scope, products]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
              state === "Live" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
            }`}
          >
            <Sparkles size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold tracking-[-0.01em] text-ink-900">{promo.name}</p>
              <Badge tone={STATE_TONE[state]}>{state}</Badge>
              <span className="text-[11.5px] font-semibold text-slate-400">{promo.code}</span>
            </div>
            <p className="mt-1 text-[13px] font-semibold text-brand-700">{describePromotion(promo)}</p>
            <p className="mt-1 text-[12.5px] text-slate-500">
              {describeScope(promo.scope)}
              {promo.scope.kind !== "products" && ` · ${num(covers)} product${covers === 1 ? "" : "s"}`}
              {" · "}
              {promo.startDate} to {promo.endDate}
              {promo.startTime && ` · ${promo.startTime}–${promo.endTime} daily`}
            </p>
            {/* Where it runs, but only when that's NOT everywhere. Tagging every
                deal "all stores" would be noise on the common case and make the
                targeted ones harder to spot, not easier. */}
            {promo.storeIds && promo.storeIds.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-violet-700">
                <StoreIcon size={13} className="shrink-0" />
                {promo.storeIds.map((id) => stores.find((s) => s.id === id)?.name || id).join(" · ")} only
              </p>
            )}
            {covers === 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-amber-600">
                <AlertTriangle size={13} /> Covers no products — this can never fire.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Priority</p>
            <p className="mt-1 text-[19px] font-extrabold tabular-nums leading-none text-ink-900">{promo.priority}</p>
          </div>
          {mayEdit && (
            <div className="flex items-center gap-1">
              <button onClick={onEdit} title="Edit" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink-900">
                <Pencil size={16} />
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

function PromotionEditor({
  draft,
  setDraft,
  products,
  suppliers,
  stores,
  busy,
  error,
  onClose,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  products: Product[];
  suppliers: Supplier[];
  stores: StoreRow[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(),
    [products],
  );

  const chosenProducts = draft.productIds.map((id) => productById.get(id)).filter(Boolean) as Product[];

  // How many products the deal would cover as configured — the sanity check
  // that catches "I picked a category with nothing in it" before it goes live.
  const covers = useMemo(() => {
    if (draft.scopeKind === "products") return draft.productIds.length;
    if (draft.scopeKind === "category")
      return products.filter((p) => draft.categories.includes(p.category)).length;
    return products.filter((p) => p.supplierCode && draft.supplierCodes.includes(p.supplierCode)).length;
  }, [draft.scopeKind, draft.productIds, draft.categories, draft.supplierCodes, products]);

  const canSave = draft.name.trim().length > 0 && covers > 0 && !busy;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={draft.id ? `Edit ${draft.name || "promotion"}` : "New promotion"}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button onClick={onSave} className="btn-primary" disabled={!canSave}>
            {busy ? "Saving…" : draft.id ? "Save promotion" : "Create promotion"}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <ErrorBox message={error} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Promotion name</label>
            <input
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Coca Cola Buy 2 Get 1 Free"
              className="input"
            />
          </div>
          <div>
            <label className="label">Type</label>
            <Select
              value={draft.type}
              onChange={(v) => set("type", v as PromotionType)}
              options={(Object.keys(PROMOTION_TYPE_LABEL) as PromotionType[]).map((t) => ({
                value: t,
                label: PROMOTION_TYPE_LABEL[t],
              }))}
            />
          </div>
          <div>
            <label className="label">Status</label>
            <Select
              value={draft.status}
              onChange={(v) => set("status", v as "Active" | "Paused")}
              options={[
                { value: "Active", label: "Active", description: "Applies as soon as it's in date" },
                { value: "Paused", label: "Paused", description: "Kept on file, never applies" },
              ]}
            />
          </div>
        </div>

        {/* The numbers that matter depend on the type — asking for a percentage
            on a buy-2-get-1 would be nonsense, so only its own fields show. */}
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="mb-3 text-[13px] font-bold text-ink-900">The deal</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">{draft.type === "BUNDLE_PRICE" ? "How many items" : "Buy quantity"}</label>
              <input
                value={draft.buyQty}
                onChange={(e) => set("buyQty", e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className="input font-semibold tabular-nums"
              />
            </div>
            {draft.type === "BUY_X_GET_Y_FREE" && (
              <div>
                <label className="label">Free quantity</label>
                <input
                  value={draft.freeQty}
                  onChange={(e) => set("freeQty", e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  className="input font-semibold tabular-nums"
                />
              </div>
            )}
            {draft.type === "BUY_X_AMOUNT_OFF" && (
              <div>
                <label className="label">Discount ($)</label>
                <input
                  value={draft.discountAmount}
                  onChange={(e) => set("discountAmount", e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="1.00"
                  className="input font-semibold tabular-nums"
                />
              </div>
            )}
            {draft.type === "BUY_X_PERCENT_OFF" && (
              <div>
                <label className="label">Discount (%)</label>
                <input
                  value={draft.discountPercent}
                  onChange={(e) => set("discountPercent", e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="10"
                  className="input font-semibold tabular-nums"
                />
              </div>
            )}
            {draft.type === "BUNDLE_PRICE" && (
              <div>
                <label className="label">Bundle price ($)</label>
                <input
                  value={draft.bundlePrice}
                  onChange={(e) => set("bundlePrice", e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="5.00"
                  className="input font-semibold tabular-nums"
                />
              </div>
            )}
            <div>
              <label className="label">Priority</label>
              <input
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className="input font-semibold tabular-nums"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                1–100. Only matters if another deal covers the same product.
              </p>
            </div>
          </div>
          {/* "Priority" means nothing on its own — say what it decides, with the
              case it actually decides it in. */}
          <p className="mt-3 border-t border-slate-200 pt-3 text-[12px] leading-relaxed text-slate-500">
            <b className="text-slate-600">What priority does:</b> if two promotions both cover the same item, the higher
            number wins and the other one doesn&apos;t apply — a customer never gets both unless you turn on
            &ldquo;Combine promotions&rdquo;. On a tie, whichever saves the customer more. If this is the only deal on
            these products, priority changes nothing — leave it at 50.
          </p>
        </div>

        {/* Scope */}
        <div>
          <p className="mb-2 text-sm font-bold text-ink-900">What it applies to</p>
          <div className="mb-3 flex gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
            {(
              [
                { k: "products", label: "Products" },
                { k: "category", label: "Categories" },
                { k: "supplier", label: "Brand / supplier" },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => set("scopeKind", t.k)}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                  draft.scopeKind === t.k ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-ink-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {draft.scopeKind === "products" && (
            <>
              {chosenProducts.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {chosenProducts.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-brand-700 ring-1 ring-brand-100">
                      {p.name} · {usd(p.price)}
                      <button
                        onClick={() => set("productIds", draft.productIds.filter((id) => id !== p.id))}
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
                options={products
                  .filter((p) => !draft.productIds.includes(p.id))
                  .map((p) => ({ value: p.id, label: p.name, hint: `${p.sku} · ${p.category} · ${usd(p.price)}` }))}
                onChange={(id) => set("productIds", [...draft.productIds, id])}
                placeholder="+ Add a product — search by name, item ID or category"
              />
            </>
          )}

          {draft.scopeKind === "category" && (
            <>
              {draft.categories.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {draft.categories.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-brand-700 ring-1 ring-brand-100">
                      {c}
                      <button
                        onClick={() => set("categories", draft.categories.filter((x) => x !== c))}
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
                options={categories
                  .filter((c) => !draft.categories.includes(c))
                  .map((c) => ({
                    value: c,
                    label: c,
                    hint: `${products.filter((p) => p.category === c).length} products`,
                  }))}
                onChange={(c) => set("categories", [...draft.categories, c])}
                placeholder="+ Add a category"
              />
            </>
          )}

          {draft.scopeKind === "supplier" && (
            <>
              <p className="mb-2 text-[12px] text-slate-400">
                The catalogue has no brand field — the supplier is the closest thing to it.
              </p>
              {draft.supplierCodes.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {draft.supplierCodes.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-brand-700 ring-1 ring-brand-100">
                      {suppliers.find((s) => s.code === code)?.name || code}
                      <button
                        onClick={() => set("supplierCodes", draft.supplierCodes.filter((x) => x !== code))}
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
                options={suppliers
                  .filter((s) => !draft.supplierCodes.includes(s.code))
                  .map((s) => ({
                    value: s.code,
                    label: s.name,
                    hint: `${s.code} · ${products.filter((p) => p.supplierCode === s.code).length} products`,
                  }))}
                onChange={(code) => set("supplierCodes", [...draft.supplierCodes, code])}
                placeholder="+ Add a brand / supplier"
              />
            </>
          )}

          <p className={`mt-2 text-[12px] font-medium ${covers === 0 ? "text-amber-600" : "text-slate-500"}`}>
            {covers === 0 ? "Covers no products yet — pick something for the deal to apply to." : `Covers ${num(covers)} product${covers === 1 ? "" : "s"}.`}
          </p>
        </div>

        {/* Where it runs. A deal is written once for the whole chain, but it
            doesn't have to run in all of it — a clearance at one shop shouldn't
            discount the same item at the others. */}
        <div>
          <p className="mb-2 text-sm font-bold text-ink-900">Where it runs</p>
          <div className="mb-3 flex gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
            {(
              [
                { all: true, label: "Every store" },
                { all: false, label: "Only some stores" },
              ] as const
            ).map((t) => (
              <button
                key={String(t.all)}
                onClick={() => set("allStores", t.all)}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                  draft.allStores === t.all ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-ink-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {draft.allStores ? (
            <p className="text-[12px] text-slate-500">
              Runs everywhere — including any store you open later.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {stores.map((s) => {
                  const on = draft.storeIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() =>
                        set("storeIds", on ? draft.storeIds.filter((x) => x !== s.id) : [...draft.storeIds, s.id])
                      }
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition ${
                        on ? "border-brand-300 bg-brand-50/60 text-ink-900" : "border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          on ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300"
                        }`}
                      >
                        {on && <Check size={11} />}
                      </span>
                      {s.name}
                    </button>
                  );
                })}
                {stores.length === 0 && (
                  <p className="text-[12px] text-slate-400">No stores to choose from.</p>
                )}
              </div>
              <p
                className={`mt-2 text-[12px] font-medium ${
                  draft.storeIds.length === 0 ? "text-amber-600" : "text-slate-500"
                }`}
              >
                {draft.storeIds.length === 0
                  ? "Pick at least one store — a deal with none runs nowhere."
                  : `Runs in ${num(draft.storeIds.length)} of ${num(stores.length)} stores. The others never see it.`}
              </p>
            </>
          )}
        </div>

        {/* When */}
        <div>
          <p className="mb-2 text-sm font-bold text-ink-900">When it runs</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">First day</label>
              <DatePicker value={draft.startDate} onChange={(v) => set("startDate", v)} />
            </div>
            <div>
              <label className="label">Last day</label>
              <DatePicker value={draft.endDate} onChange={(v) => set("endDate", v)} min={draft.startDate} />
            </div>
            <div>
              <label className="label">From (daily)</label>
              <input
                value={draft.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                placeholder="all day"
                className="input tabular-nums"
              />
            </div>
            <div>
              <label className="label">To (daily)</label>
              <input
                value={draft.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                placeholder="all day"
                className="input tabular-nums"
              />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            Leave both times blank to run all day. Times are the shop&apos;s own clock (Phnom Penh), and a window like
            22:00–02:00 runs overnight. The last day is included in full.
          </p>
        </div>
      </div>
    </Modal>
  );
}
