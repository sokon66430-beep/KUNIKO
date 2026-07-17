"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { barcodeIncludes } from "@/lib/barcodes";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Package,
  AlertTriangle,
  DollarSign,
  Pencil,
  Trash2,
  PackagePlus,
  Truck,
  Upload,
  FileSpreadsheet,
  FileType2,
  ClipboardCheck,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier , StockCount } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { SearchSelect } from "@/components/SearchSelect";
import { ProductModal, EMPTY_PRODUCT as EMPTY } from "@/components/ProductModal";
import { usd, num, gpPercent } from "@/lib/format";
import { baseUnitName, describeBreakdown, sellableUnits, toBaseQty, unitsOf } from "@/lib/sellingUnits";
import { Select } from "@/components/Select";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/products");
  // For the accuracy card and last-count date only — the counts themselves
  // live on /stock-count.
  const { data: counts } = useFetch<StockCount[]>("/api/stock-counts");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [supplierFilterApplied, setSupplierFilterApplied] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [restock, setRestock] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Import the store's inventory sheet (same columns as the export/template).
  async function importExcel(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/products/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Import failed (${res.status})`);
      setImportMsg(
        `Import complete — ${num(data.created)} new · ${num(data.updated)} updated${
          data.skipped ? ` · ${num(data.skipped)} skipped` : ""
        }`,
      );
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
          barcodeIncludes(p, q),
      );
    }
    return list;
  }, [products, category, supplierFilter, query]);

  const lowStock = (products || []).filter((p) => p.stock <= p.reorderLevel).length;
  const invValue = (products || []).reduce((s, p) => s + p.cost * p.stock, 0);
  // Inventory-health figures (migration dashboard). Zero/negative are split
  // out: a zero might be sold-through, a NEGATIVE is always a bookkeeping
  // wound — more sold than the book ever had — and the next count heals it.
  const totalUnits = (products || []).reduce((s, p) => s + Math.max(0, p.stock), 0);
  const zeroStock = (products || []).filter((p) => p.stock === 0).length;
  const negativeStock = (products || []).filter((p) => p.stock < 0).length;
  // Accuracy from the last POSTED count: how much of what the book claimed was
  // really on the shelf. 100 × (1 − Σ|counted − book| / Σ book).
  const lastPosted = (counts || []).filter((c) => c.status === "Posted").sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""))[0];
  const accuracy = (() => {
    if (!lastPosted) return null;
    let absVar = 0, book = 0;
    for (const it of lastPosted.items) {
      absVar += Math.abs(it.countedQty - it.systemQty);
      book += Math.abs(it.systemQty);
    }
    if (book === 0) return null;
    return Math.max(0, Math.round((1 - absVar / book) * 1000) / 10);
  })();

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
          <div className="flex flex-wrap items-center gap-2">
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
            <a className="btn-ghost !py-2 text-sm" href="/api/products/export" title="Download inventory as Excel">
              <FileSpreadsheet size={16} /> Export
            </a>
            <a className="btn-ghost !py-2 text-sm" href="/api/products/export?format=pdf" title="Download inventory as PDF">
              <FileType2 size={16} /> PDF
            </a>
            <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <Plus size={18} /> Add Product
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      {importMsg && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {importMsg}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Stock" value={num(totalUnits)} sub={`${num(products?.length || 0)} products`} icon={<Package size={18} />} accent="brand" />
        <StatCard label="Stock Value (cost)" value={usd(invValue)} icon={<DollarSign size={18} />} accent="emerald" />
        <StatCard label="Low Stock" value={num(lowStock)} sub="at or under reorder level" icon={<AlertTriangle size={18} />} accent="amber" />
        <StatCard
          label="Zero / Negative"
          value={`${num(zeroStock)} · ${num(negativeStock)}`}
          sub={negativeStock > 0 ? "negative stock needs a count" : "no negative stock"}
          icon={<AlertTriangle size={18} />}
          accent={negativeStock > 0 ? "rose" : "violet"}
        />
        <StatCard
          label="Inventory Accuracy"
          value={accuracy != null ? `${accuracy}%` : "—"}
          sub={lastPosted ? `from ${lastPosted.countNo}` : "no posted count yet"}
          icon={<ClipboardCheck size={18} />}
          accent={accuracy == null ? "brand" : accuracy >= 97 ? "emerald" : accuracy >= 90 ? "amber" : "rose"}
        />
        <StatCard
          label="Last Stock Count"
          value={lastPosted?.postedAt ? new Date(lastPosted.postedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
          sub={lastPosted ? `${num(lastPosted.items.length)} items counted` : "count the store to start"}
          icon={<ClipboardCheck size={18} />}
          accent="brand"
        />
        <StatCard label="Categories" value={num(categories.length - 1)} icon={<Package size={18} />} accent="violet" />
        <StatCard
          label="Ledger"
          value={<a href="/inventory-ledger" className="text-brand-600 hover:underline">View</a>}
          sub="every movement on record"
          icon={<Package size={18} />}
          accent="brand"
        />
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
          <div>
            {/* A column header row. The stock figure used to sit in this list as
                a bare number with nothing saying what it was. */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                <span>Product</span>
                <span className="flex items-center gap-3">
                  <span className="w-24 text-right">On hand</span>
                  <span className="w-[4.5rem] text-center">Status</span>
                  <span className="w-[6.5rem] text-right">Actions</span>
                </span>
              </div>
            )}
            {filtered.map((p) => {
              const margin = gpPercent(p.cost, p.price);
              const status =
                p.stock <= 0 ? "out" : p.stock <= p.reorderLevel ? "low" : "ok";
              return (
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
                      {p.category} · {p.supplier} · {usd(p.cost)} →{" "}
                      <span className="font-semibold text-ink-800">{usd(p.price)}</span> ·{" "}
                      <span className="text-emerald-600">{margin.toFixed(0)}% GP</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* The balance is always the base count. The packaging
                        breakdown underneath is for the human counting the
                        shelf, who thinks in cases. */}
                    <span className="w-24 text-right">
                      <span
                        className={`block text-[15px] font-bold tabular-nums ${
                          p.stock < 0 ? "text-rose-600" : p.stock === 0 ? "text-slate-400" : "text-ink-900"
                        }`}
                      >
                        {num(p.stock)}
                      </span>
                      {describeBreakdown(p.stock, unitsOf(p)) && (
                        <span className="block text-[11px] text-slate-500">
                          {describeBreakdown(p.stock, unitsOf(p))}
                        </span>
                      )}
                    </span>
                    {/* Most of this catalogue sits at zero, so "Out" is the
                        normal case here — in red on every row it would drown out
                        the handful of items that are genuinely running low. */}
                    <span className="flex w-[4.5rem] justify-center">
                      {status === "out" && <Badge tone="muted">Out</Badge>}
                      {status === "low" && <Badge tone="amber">Low</Badge>}
                      {status === "ok" && <Badge tone="emerald">In stock</Badge>}
                    </span>
                    <div className="flex w-[6.5rem] items-center justify-end gap-1">
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
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-5 py-12 text-center text-slate-400">No products found.</p>
            )}
          </div>
        )}
      </Card>

      {/* Add / edit modal */}
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
  // Deliveries arrive in cases, not cans. Counting in the packaging the pallet
  // actually came in — and letting the system do the ×24 — is what stops a
  // mis-typed multiplication becoming a stock error nobody can trace.
  const units = sellableUnits(product);
  const [unitId, setUnitId] = useState(units[0].id);
  const unit = units.find((u) => u.id === unitId) || units[0];
  const added = toBaseQty(unit, Number(qty) || 0);
  const base = baseUnitName(product);

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
          <button className="btn-primary" disabled={busy} onClick={() => onConfirm(product, added)}>
            {busy ? "Saving…" : `Add ${added} ${base.toLowerCase()}${added === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Current stock:{" "}
        <span className="font-bold text-ink-800">
          {product.stock} {base.toLowerCase()}
          {product.stock === 1 ? "" : "s"}
        </span>
        {describeBreakdown(product.stock, unitsOf(product)) && ` (${describeBreakdown(product.stock, unitsOf(product))})`}{" "}
        · reorder at {product.reorderLevel}
      </p>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label">Quantity received</label>
          <input className="input" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        {units.length > 1 && (
          <div className="w-40">
            <label className="label">Received as</label>
            <Select
              value={unitId}
              onChange={setUnitId}
              options={units.map((u) => ({
                value: u.id,
                label: u.name,
                description: u.isBase ? "single" : `${u.conversion} ${base.toLowerCase()}s each`,
              }))}
            />
          </div>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-500">
        {!unit.isBase && (
          <>
            {qty} × {unit.name} = <span className="font-semibold text-ink-800">{added}</span> {base.toLowerCase()}s ·{" "}
          </>
        )}
        New stock will be{" "}
        <span className="font-bold text-emerald-600">
          {product.stock + added} {base.toLowerCase()}
          {product.stock + added === 1 ? "" : "s"}
        </span>
      </p>
    </Modal>
  );
}
