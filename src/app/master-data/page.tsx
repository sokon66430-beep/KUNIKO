"use client";

import { useMemo, useRef, useState } from "react";
import { barcodeIncludes } from "@/lib/barcodes";
import {
  Search,
  Plus,
  Package,
  Boxes,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  Upload,
  FileSpreadsheet,
  Truck,
  Phone,
  ChefHat,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier, Recipe, Promotion } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { ProductModal, EMPTY_PRODUCT as EMPTY } from "@/components/ProductModal";
import { SupplierModal, EMPTY_SUPPLIER } from "@/components/SupplierModal";
import { formatLocations } from "@/lib/location";
import { usd, num } from "@/lib/format";

export const dynamic = "force-dynamic";

type SyncResult = {
  masterCount: number;
  stores: { store: string; added: number; updated: number; removed: number; keptWithStock: number }[];
};

export default function MasterDataPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/master/products");
  const { data: suppliers, reload: reloadSuppliers } = useFetch<Supplier[]>("/api/master/suppliers");
  const { data: masterRecipes } = useFetch<Recipe[]>("/api/master/recipes");
  const { data: masterPromotions } = useFetch<Promotion[]>("/api/master/promotions");
  const [tab, setTab] = useState<"products" | "suppliers" | "recipes" | "promotions">("products");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [editingSup, setEditingSup] = useState<Partial<Supplier> | null>(null);
  const [busy, setBusy] = useState(false);

  // How many master products are linked to each supplier — shown per row, and
  // used to explain a blocked delete.
  const productCountByCode = useMemo(() => {
    const m = new Map<string, number>();
    (products || []).forEach((p) => {
      if (p.supplierCode) m.set(p.supplierCode, (m.get(p.supplierCode) || 0) + 1);
    });
    return m;
  }, [products]);

  const supList = suppliers || [];
  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return supList;
    return supList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.contactPerson || "").toLowerCase().includes(q),
    );
  }, [supList, query]);

  const [syncingSup, setSyncingSup] = useState(false);
  const [supSyncResult, setSupSyncResult] = useState<{ suppliers: number; stores: number } | null>(null);
  async function syncSuppliers() {
    setSyncingSup(true);
    setSupSyncResult(null);
    try {
      const r = await api<{ suppliers: number; stores: number }>("/api/master/suppliers/sync", { method: "POST" });
      setSupSyncResult(r);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSyncingSup(false);
    }
  }

  async function saveSupplier(s: Partial<Supplier>) {
    setBusy(true);
    try {
      if (s.code && supList.some((x) => x.code === s.code) && editingSup?.code) {
        await api(`/api/master/suppliers/${encodeURIComponent(s.code)}`, { method: "PATCH", body: JSON.stringify(s) });
      } else {
        await api("/api/master/suppliers", { method: "POST", body: JSON.stringify(s) });
      }
      setEditingSup(null);
      reloadSuppliers();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeSupplier(s: Supplier) {
    const linked = productCountByCode.get(s.code) || 0;
    if (linked > 0) {
      alert(`Can't delete "${s.name}" — ${linked} product${linked === 1 ? "" : "s"} still linked. Reassign or remove them first.`);
      return;
    }
    if (
      !(await confirmDialog({
        title: "Delete supplier",
        message: `Delete supplier "${s.name}" from the master? It's removed from every store.`,
        confirmText: "Delete",
      }))
    )
      return;
    try {
      await api(`/api/master/suppliers/${encodeURIComponent(s.code)}`, { method: "DELETE" });
      reloadSuppliers();
    } catch (e: any) {
      alert(e.message);
    }
  }
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importExcel(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/master/products/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Import failed (${res.status})`);
      setImportMsg(`Master updated — ${num(data.created)} new · ${num(data.updated)} updated. Click "Sync to stores" to push it out.`);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const categories = useMemo(() => {
    const set = new Set((products || []).map((p) => p.category).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const list = products || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        barcodeIncludes(p, q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.supplier || "").toLowerCase().includes(q) ||
        (p.supplierCode || "").toLowerCase().includes(q),
    );
  }, [products, query]);

  async function saveProduct(p: Partial<Product>) {
    setBusy(true);
    try {
      if (p.id) await api(`/api/master/products/${p.id}`, { method: "PATCH", body: JSON.stringify(p) });
      else await api("/api/master/products", { method: "POST", body: JSON.stringify(p) });
      setEditing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Product) {
    if (
      !(await confirmDialog({
        title: "Delete from master",
        message: `Remove "${p.name}" from the master catalog? Stores keep their copy until you sync. This cannot be undone.`,
        confirmText: "Delete",
      }))
    )
      return;
    await api(`/api/master/products/${p.id}`, { method: "DELETE" });
    reload();
  }

  async function sync() {
    if (
      !(await confirmDialog({
        title: "Sync master to all stores",
        message:
          "Make every store an exact mirror of the master: master info (name, barcode, category, cost, selling price, supplier) is pushed to all stores; new products are added (stock 0). Each store keeps its own reorder level, stock and shelf location. Products a store has that are NOT in the master are removed — except any that still hold stock, which are kept and reported.",
        confirmText: "Sync to stores",
        tone: "brand",
      }))
    )
      return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api<SyncResult>("/api/master/sync", { method: "POST" });
      setSyncResult(r);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Master Data"
        subtitle="One central product catalog for every store. Edit here, then Sync — every store follows the master (including selling price); each keeps its own reorder level, stock & shelf location."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tab === "products" ? (
              <>
                <button className="btn-ghost !py-2 text-sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                  <Upload size={16} /> {importing ? "Importing…" : "Import"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importExcel(f);
                  }}
                />
                <a className="btn-ghost !py-2 text-sm" href="/api/master/products/export" title="Download master as Excel">
                  <FileSpreadsheet size={16} /> Export
                </a>
                <button className="btn-ghost !py-2 text-sm" disabled={syncing} onClick={sync} title="Push shared info to every store">
                  <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync to stores"}
                </button>
                <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
                  <Plus size={18} /> Add Product
                </button>
              </>
            ) : tab === "suppliers" ? (
              <>
                <button
                  className="btn-ghost !py-2 text-sm"
                  disabled={syncingSup}
                  onClick={syncSuppliers}
                  title="Push the supplier list to every store"
                >
                  <RefreshCw size={16} className={syncingSup ? "animate-spin" : ""} />{" "}
                  {syncingSup ? "Syncing…" : "Sync to stores"}
                </button>
                <button className="btn-primary" onClick={() => setEditingSup({ ...EMPTY_SUPPLIER })}>
                  <Plus size={18} /> Add Supplier
                </button>
              </>
            ) : (
              // Recipes and deals are written on their own pages — store
              // leadership can reach those, and this one is owner-only. Sending
              // them there beats a second editor that could drift from the first.
              <Link className="btn-primary" href={tab === "recipes" ? "/recipes" : "/deals"}>
                <Pencil size={16} /> {tab === "recipes" ? "Manage recipes" : "Manage promotions"}
              </Link>
            )}
          </div>
        }
      />

      {/* Everything the chain shares lives here — the catalogs it buys and sells
          from, plus the recipes and deals every shop runs. All of it is the
          single source of truth, pushed to every store. */}
      <div className="mb-5 inline-flex rounded-xl bg-slate-100 p-1">
        {([
          { key: "products", label: "Products", icon: <Boxes size={15} /> },
          { key: "suppliers", label: "Suppliers", icon: <Truck size={15} /> },
          { key: "recipes", label: "Recipes", icon: <ChefHat size={15} /> },
          { key: "promotions", label: "Promotions", icon: <Sparkles size={15} /> },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setQuery("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}

      {importMsg && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {importMsg}
        </div>
      )}

      {syncResult && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={16} /> Synced {num(syncResult.masterCount)} master products to {syncResult.stores.length}{" "}
            store{syncResult.stores.length === 1 ? "" : "s"}.
          </p>
          <div className="mt-2 space-y-1 text-xs text-emerald-700">
            {syncResult.stores.map((s) => (
              <div key={s.store} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{s.store}:</span>
                <span>{num(s.added)} added</span>
                <span>· {num(s.updated)} updated</span>
                {s.removed > 0 && <span className="text-rose-600">· {num(s.removed)} removed</span>}
                {s.keptWithStock > 0 && (
                  <span className="text-amber-600">· {num(s.keptWithStock)} kept (still has stock)</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "products" && (
        <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Master Products" value={num(products?.length || 0)} icon={<Boxes size={18} />} accent="brand" />
        <StatCard label="Categories" value={num(categories.length - 1)} icon={<Package size={18} />} accent="violet" />
        <StatCard
          label="With Location"
          value={num((products || []).filter((p) => formatLocations(p)).length)}
          icon={<Package size={18} />}
          accent="emerald"
        />
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder="Search master by name, Item ID, barcode, category or supplier…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading master catalog…" />
        ) : (
          <div>
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {p.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {p.sku}
                      {p.barcode ? ` · ${p.barcode}` : ""}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {p.category} · {p.supplier} · cost {usd(p.cost)}
                    {formatLocations(p) ? ` · 📍 ${formatLocations(p)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    title="Edit"
                    onClick={() => setEditing(p)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    title="Delete from master"
                    onClick={() => remove(p)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="px-5 py-12 text-center text-slate-400">No products found.</p>}
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        Selling price is central — editing it here updates every store on the next Sync. Reorder level and stock in the
        editor are only starting values for a brand-new product; each store then sets and keeps its own, and shelf
        location is always per-store (set on the Price labels page).
      </p>
        </>
      )}

      {tab === "suppliers" && (
        <>
          {supSyncResult && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 size={16} /> Synced {num(supSyncResult.suppliers)} suppliers to {supSyncResult.stores}{" "}
              store{supSyncResult.stores === 1 ? "" : "s"}.
            </div>
          )}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Suppliers" value={num(supList.length)} icon={<Truck size={18} />} accent="brand" />
            <StatCard
              label="Products Linked"
              value={num([...productCountByCode.values()].reduce((a, b) => a + b, 0))}
              icon={<Package size={18} />}
              accent="emerald"
            />
            <StatCard
              label="With Contact"
              value={num(supList.filter((s) => s.contactPerson || s.phone).length)}
              icon={<Boxes size={18} />}
              accent="violet"
            />
            <StatCard
              label="Avg Lead Time"
              value={`${Math.round(supList.reduce((a, s) => a + (s.leadTime || 0), 0) / (supList.length || 1))}d`}
              icon={<Package size={18} />}
              accent="amber"
            />
          </div>

          <Card className="p-0">
            <div className="border-b border-slate-100 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  className="input pl-10"
                  placeholder="Search supplier by name, code or contact…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <Spinner label="Loading suppliers…" />
            ) : (
              <div>
                {filteredSuppliers.map((s) => {
                  const count = productCountByCode.get(s.code) || 0;
                  return (
                    <div
                      key={s.code}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900">
                          {s.name}
                          <span className="ml-2 text-xs font-normal text-slate-400">{s.code}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 truncate text-sm text-slate-500">
                          <span>{s.contactPerson || "—"}</span>
                          {s.phone && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                              <Phone size={11} /> {s.phone}
                            </span>
                          )}
                          {s.leadTime ? <span className="text-slate-400">{s.leadTime}d lead</span> : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={count > 0 ? "brand" : "slate"}>{count} products</Badge>
                        <div className="flex items-center gap-1">
                          <button
                            title="Edit"
                            onClick={() => setEditingSup(s)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            title={count > 0 ? "Linked to products — can't delete" : "Delete"}
                            onClick={() => removeSupplier(s)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredSuppliers.length === 0 && (
                  <p className="px-5 py-12 text-center text-slate-400">No suppliers found.</p>
                )}
              </div>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-400">
            Suppliers are controlled here and mirrored to every store automatically. A supplier can&apos;t be deleted
            while products are still linked to it.
          </p>
        </>
      )}

      {tab === "recipes" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label="Master Recipes" value={num(masterRecipes?.length || 0)} icon={<ChefHat size={18} />} accent="violet" />
            <StatCard
              label="Live"
              value={num((masterRecipes || []).filter((r) => r.status === "Active").length)}
              sub="deducting on every sale"
              icon={<CheckCircle2 size={18} />}
              accent="emerald"
            />
            <StatCard
              label="Ingredients"
              value={num((masterRecipes || []).reduce((s, r) => s + r.items.length, 0))}
              sub="lines across all recipes"
              icon={<Boxes size={18} />}
            />
          </div>
          <Card>
            {!masterRecipes ? (
              <Spinner label="Loading recipes…" />
            ) : masterRecipes.length === 0 ? (
              <p className="px-5 py-12 text-center text-slate-400">No recipes yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {masterRecipes.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 px-1 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-ink-900">{r.name}</p>
                        <Badge tone={r.status === "Active" ? "emerald" : "muted"}>{r.status}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        <span className="font-mono font-semibold text-slate-500">{r.code}</span> ·{" "}
                        {r.items.length} ingredient{r.items.length === 1 ? "" : "s"}
                        {r.items.length ? ` · ${r.items.map((i) => i.name).slice(0, 3).join(", ")}` : ""}
                        {r.items.length > 3 ? "…" : ""}
                      </p>
                    </div>
                    <Link href="/recipes" className="btn-ghost !py-2 text-xs">
                      <Pencil size={14} /> Edit
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-400">
            Recipes are central — written once and mirrored into every store, so a bowl costs the same wherever it&apos;s
            made. Edit them on the Recipes page; which product a recipe is cooked for stays per store.
          </p>
        </>
      )}

      {tab === "promotions" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="Master Promotions"
              value={num(masterPromotions?.length || 0)}
              icon={<Sparkles size={18} />}
              accent="emerald"
            />
            <StatCard
              label="Live"
              value={num((masterPromotions || []).filter((p) => p.status === "Active").length)}
              sub="can fire at the till"
              icon={<CheckCircle2 size={18} />}
              accent="brand"
            />
            <StatCard
              label="Paused"
              value={num((masterPromotions || []).filter((p) => p.status !== "Active").length)}
              sub="kept, not running"
              icon={<Package size={18} />}
              accent="amber"
            />
          </div>
          <Card>
            {!masterPromotions ? (
              <Spinner label="Loading promotions…" />
            ) : masterPromotions.length === 0 ? (
              <p className="px-5 py-12 text-center text-slate-400">No promotions yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {masterPromotions.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-1 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-ink-900">{p.name}</p>
                        <Badge tone={p.status === "Active" ? "emerald" : "muted"}>{p.status}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        <span className="font-mono font-semibold text-slate-500">{p.code}</span> · {p.startDate} to{" "}
                        {p.endDate} · priority {p.priority}
                      </p>
                    </div>
                    <Link href="/deals" className="btn-ghost !py-2 text-xs">
                      <Pencil size={14} /> Edit
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-400">
            Promotions are central — set one up once and it runs in every store. Edit them on the Promotions page.
          </p>
        </>
      )}

      {editingSup && (
        <SupplierModal
          initial={editingSup}
          isNew={!supList.some((s) => s.code === editingSup.code)}
          busy={busy}
          onClose={() => setEditingSup(null)}
          onSave={saveSupplier}
        />
      )}

      {editing && (
        <ProductModal
          initial={editing}
          suppliers={suppliers || []}
          categories={categories}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}
    </div>
  );
}
