"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Plus, Package, AlertTriangle, DollarSign, Pencil, Trash2, PackagePlus, Truck } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { SearchSelect } from "@/components/SearchSelect";
import { ProductModal, EMPTY_PRODUCT as EMPTY } from "@/components/ProductModal";
import { usd, num, gpPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/products");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [supplierFilterApplied, setSupplierFilterApplied] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [restock, setRestock] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  // Deep-link from the Suppliers page ("View products") — resolve the
  // supplierCode in the URL to that supplier's display name once loaded.
  useEffect(() => {
    if (supplierFilterApplied || !suppliers) return;
    const code = searchParams.get("supplier");
    if (code) {
      const match = suppliers.find((s) => s.code === code);
      if (match) setSupplierFilter(match.name);
    }
    setSupplierFilterApplied(true);
  }, [suppliers, searchParams, supplierFilterApplied]);

  const categories = useMemo(() => {
    const set = new Set((products || []).map((p) => p.category));
    return ["All", ...Array.from(set).sort()];
  }, [products]);

  const supplierNames = useMemo(() => {
    const set = new Set((products || []).map((p) => p.supplier).filter((s) => s && s !== "—"));
    return ["All", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    let list = products || [];
    if (category !== "All") list = list.filter((p) => p.category === category);
    if (supplierFilter !== "All") list = list.filter((p) => p.supplier === supplierFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode || "").includes(q),
      );
    }
    return list;
  }, [products, category, supplierFilter, query]);

  const lowStock = (products || []).filter((p) => p.stock <= p.reorderLevel).length;
  const invValue = (products || []).reduce((s, p) => s + p.cost * p.stock, 0);

  async function saveProduct(p: Partial<Product>) {
    setBusy(true);
    try {
      if (p.id) {
        await api(`/api/products/${p.id}`, { method: "PATCH", body: JSON.stringify(p) });
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(p) });
      }
      setEditing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doRestock(p: Product, addQty: number) {
    setBusy(true);
    try {
      await api(`/api/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stock: p.stock + addQty }),
      });
      setRestock(null);
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
        title: "Delete product",
        message: `Delete "${p.name}"? This cannot be undone.`,
        confirmText: "Delete",
      }))
    )
      return;
    await api(`/api/products/${p.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Product master — stock, costs, reorder levels & supplier links"
        actions={
          <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
            <Plus size={18} /> Add Product
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Products" value={num(products?.length || 0)} icon={<Package size={18} />} accent="brand" />
        <StatCard label="Low / Out of Stock" value={num(lowStock)} icon={<AlertTriangle size={18} />} accent="amber" />
        <StatCard label="Stock Value (cost)" value={usd(invValue)} icon={<DollarSign size={18} />} accent="emerald" />
        <StatCard label="Categories" value={num(categories.length - 1)} icon={<Package size={18} />} accent="violet" />
      </div>

      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder="Search by name, Item ID or barcode…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <SearchSelect
            className="sm:w-52"
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ value: c, label: c === "All" ? "All Categories" : c }))}
          />
          <SearchSelect
            className="sm:w-60"
            value={supplierFilter}
            onChange={setSupplierFilter}
            options={[
              { value: "All", label: "All Suppliers" },
              ...supplierNames.filter((s) => s !== "All").map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>

        {loading ? (
          <Spinner label="Loading inventory…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Cost</th>
                  <th className="px-4 py-3 text-right font-semibold">Price</th>
                  <th className="px-4 py-3 text-right font-semibold">GP %</th>
                  <th className="px-4 py-3 text-center font-semibold">Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const margin = gpPercent(p.cost, p.price);
                  const status =
                    p.stock <= 0 ? "out" : p.stock <= p.reorderLevel ? "low" : "ok";
                  return (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.sku} · {p.supplier}</p>
                        {p.barcode && <p className="text-[11px] text-slate-400">{p.barcode}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.category}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{usd(p.cost)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-ink-800">{usd(p.price)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{margin.toFixed(0)}%</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-bold text-ink-900">{p.stock}</span>
                          {status === "out" && <Badge tone="rose">Out</Badge>}
                          {status === "low" && <Badge tone="amber">Low</Badge>}
                          {status === "ok" && <Badge tone="emerald">In stock</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Restock"
                            onClick={() => setRestock(p)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                          >
                            <PackagePlus size={16} />
                          </button>
                          <button
                            title="Edit"
                            onClick={() => setEditing(p)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            title="Delete"
                            onClick={() => remove(p)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add / edit modal */}
      {editing && (
        <ProductModal
          initial={editing}
          suppliers={suppliers || []}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}

      {/* Restock modal */}
      {restock && (
        <RestockModal product={restock} busy={busy} onClose={() => setRestock(null)} onConfirm={doRestock} />
      )}
    </div>
  );
}

function RestockModal({
  product,
  busy,
  onClose,
  onConfirm,
}: {
  product: Product;
  busy: boolean;
  onClose: () => void;
  onConfirm: (p: Product, qty: number) => void;
}) {
  const [qty, setQty] = useState(product.reorderLevel || 12);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Restock — ${product.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => onConfirm(product, Number(qty) || 0)}>
            {busy ? "Saving…" : `Add ${qty} ${product.unit}`}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Current stock: <span className="font-bold text-ink-800">{product.stock} {product.unit}</span> · reorder at{" "}
        {product.reorderLevel}
      </p>
      <label className="label">Quantity to add</label>
      <input className="input" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      <p className="mt-2 text-sm text-slate-500">
        New stock will be <span className="font-bold text-emerald-600">{product.stock + (Number(qty) || 0)} {product.unit}</span>
      </p>
    </Modal>
  );
}
