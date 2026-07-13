"use client";

import { useMemo, useState } from "react";
import { Search, Plus, Package, Boxes, Pencil, Trash2, RefreshCw, CheckCircle2, ChevronRight } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { ProductModal, EMPTY_PRODUCT as EMPTY } from "@/components/ProductModal";
import { formatLocations } from "@/lib/location";
import { usd, num } from "@/lib/format";

export const dynamic = "force-dynamic";

type SyncResult = {
  masterCount: number;
  stores: { store: string; added: number; updated: number; extra: number }[];
};

export default function MasterDataPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/master/products");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

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
        (p.barcode || "").includes(q) ||
        (p.category || "").toLowerCase().includes(q),
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
          "Push the master's shared info (name, barcode, category, cost, location, supplier) to every store. Each store keeps its own price, reorder level and stock. New products are added with stock 0. Nothing is deleted.",
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
        subtitle="One central product catalog for every store. Edit here, then Sync — shared info flows to all stores, each keeps its own price, reorder level & stock."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" disabled={syncing} onClick={sync} title="Push shared info to every store">
              <RefreshCw size={18} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync to stores"}
            </button>
            <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <Plus size={18} /> Add Product
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

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
                {s.extra > 0 && <span className="text-amber-600">· {num(s.extra)} store-only (kept)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

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
              placeholder="Search master by name, Item ID, barcode or category…"
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
        Price, reorder level and stock shown in the editor are only the starting values for a brand-new product — each
        store sets and keeps its own. Editing them here never overrides a store on Sync.
      </p>

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
