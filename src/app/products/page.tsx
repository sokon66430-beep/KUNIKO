"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Barcode,
  Package,
  Truck,
  Layers,
  Link2,
  Phone,
  CalendarClock,
  ClipboardList,
  PackageCheck,
  Plus,
  FileSpreadsheet,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Supplier, PurchaseOrder, GoodsReceipt } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { ProductModal, EMPTY_PRODUCT } from "@/components/ProductModal";
import { usd, num, shortDate, gpPercent } from "@/lib/format";

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  totalRows: number;
  errors: string[];
};

const PAGE_SIZE = 100;

export default function ProductsPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/products");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  const { data: pos } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const { data: grns } = useFetch<GoodsReceipt[]>("/api/goods-receipts");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveProduct(p: Partial<Product>) {
    setBusy(true);
    try {
      if (p.id) {
        await api(`/api/products/${p.id}`, { method: "PATCH", body: JSON.stringify(p) });
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(p) });
      }
      setEditing(null);
      setViewing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct(p: Product) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/products/${p.id}`, { method: "DELETE" });
      setViewing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function importExcel(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/products/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Import failed (${res.status})`);
      setImportResult(data);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const list = products || [];

  const categories = useMemo(() => {
    const set = new Set(list.map((p) => p.category));
    return ["All", ...Array.from(set).sort()];
  }, [list]);

  const supplierNames = useMemo(() => {
    const set = new Set(list.map((p) => p.supplier).filter((s) => s && s !== "—"));
    return Array.from(set).sort();
  }, [list]);

  const filtered = useMemo(() => {
    let result = list;
    if (category !== "All") result = result.filter((p) => p.category === category);
    if (supplierFilter !== "All") result = result.filter((p) => p.supplier === supplierFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode || "").includes(q),
      );
    }
    return result;
  }, [list, category, supplierFilter, query]);

  const shown = filtered.slice(0, limit);
  const withBarcode = list.filter((p) => p.barcode).length;
  const linked = list.filter((p) => p.supplierCode).length;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Full product master — every item, barcode, price and supplier link"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importExcel(f);
              }}
            />
            <button className="btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet size={18} /> {importing ? "Importing…" : "Import Excel"}
            </button>
            <button className="btn-primary" onClick={() => setEditing({ ...EMPTY_PRODUCT })}>
              <Plus size={18} /> Add Product
            </button>
          </>
        }
      />

      {error && <ErrorBox message={error} />}

      {importResult && (
        <div className="mb-4 flex items-start justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div>
            <p className="font-semibold">
              Import complete — {num(importResult.created)} new, {num(importResult.updated)} updated
              {importResult.skipped > 0 ? `, ${num(importResult.skipped)} skipped` : ""} (
              {num(importResult.totalRows)} rows read)
            </p>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                {importResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={() => setImportResult(null)} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-100">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Products" value={num(list.length)} icon={<Package size={18} />} accent="brand" />
        <StatCard label="With Barcode" value={num(withBarcode)} icon={<Barcode size={18} />} accent="emerald" />
        <StatCard label="Linked to Supplier" value={num(linked)} icon={<Link2 size={18} />} accent="violet" />
        <StatCard label="Categories" value={num(categories.length - 1)} icon={<Layers size={18} />} accent="amber" />
      </div>

      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder="Search by name, Item ID or barcode…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_SIZE);
              }}
            />
          </div>
          <select
            className="input sm:w-44"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            className="input sm:w-56"
            value={supplierFilter}
            onChange={(e) => {
              setSupplierFilter(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="All">All Suppliers</option>
            {supplierNames.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner label="Loading products…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products found" hint="Try a different search or filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Barcode</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Supplier</th>
                    <th className="px-4 py-3 text-center font-semibold">Unit</th>
                    <th className="px-4 py-3 text-right font-semibold">Cost</th>
                    <th className="px-4 py-3 text-right font-semibold">Price</th>
                    <th className="px-4 py-3 text-right font-semibold">GP%</th>
                    <th className="px-4 py-3 text-center font-semibold">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const gp = gpPercent(p.cost, p.price);
                    return (
                      <tr
                        key={p.id}
                        className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                        onClick={() => setViewing(p)}
                      >
                        <td className="px-4 py-3">
                          <span className="text-xs text-ink-700">{p.barcode || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-ink-800">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{p.category}</td>
                        <td className="px-4 py-3">
                          {p.supplierCode ? (
                            <span className="text-slate-600">{p.supplier}</span>
                          ) : (
                            <Badge tone="amber">Not linked</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500">{p.unit}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{usd(p.cost)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-ink-800">{usd(p.price)}</td>
                        <td className="px-4 py-3 text-right text-emerald-600">{gp.toFixed(0)}%</td>
                        <td className="px-4 py-3 text-center font-semibold text-ink-900">{p.stock}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>
                Showing {num(shown.length)} of {num(filtered.length)}
                {filtered.length !== list.length ? ` (filtered from ${num(list.length)})` : ""}
              </span>
              {shown.length < filtered.length && (
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {viewing && !editing && (
        <ProductDetailModal
          product={viewing}
          supplier={(suppliers || []).find((s) => s.code === viewing.supplierCode)}
          pos={pos || []}
          grns={grns || []}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(viewing)}
          onDelete={() => removeProduct(viewing)}
        />
      )}

      {editing && (
        <ProductModal
          initial={editing}
          suppliers={suppliers || []}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm text-ink-800 ${mono ? "font-mono" : "font-semibold"}`}>{value}</p>
    </div>
  );
}

function ProductDetailModal({
  product: p,
  supplier,
  pos,
  grns,
  onClose,
  onEdit,
  onDelete,
}: {
  product: Product;
  supplier?: Supplier;
  pos: PurchaseOrder[];
  grns: GoodsReceipt[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const gp = gpPercent(p.cost, p.price);

  const poHistory = pos
    .map((po) => {
      const line = po.items.find((i) => i.productId === p.id);
      return line ? { po, line } : null;
    })
    .filter(Boolean) as { po: PurchaseOrder; line: PurchaseOrder["items"][number] }[];

  const grnHistory = grns
    .map((g) => {
      const line = g.items.find((i) => i.productId === p.id);
      return line ? { g, line } : null;
    })
    .filter(Boolean) as { g: GoodsReceipt; line: GoodsReceipt["items"][number] }[];

  return (
    <Modal
      open
      onClose={onClose}
      title={p.name}
      footer={
        <div className="flex w-full items-center justify-between">
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 size={16} /> Delete
          </button>
          <div className="flex gap-2">
            <Link href={`/inventory?supplier=${encodeURIComponent(p.supplierCode || "")}`} className="btn-ghost">
              <Package size={16} /> Inventory
            </Link>
            <button className="btn-primary" onClick={onEdit}>
              <Pencil size={16} /> Edit Product
            </button>
          </div>
        </div>
      }
    >
      {/* Identity */}
      <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Barcode size={18} className="text-brand-600" />
          <span className="text-lg font-bold tracking-wide text-ink-900">{p.barcode || "No barcode"}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Item ID {p.sku}</p>
      </div>

      {/* Core details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Field label="Category" value={p.category} />
        <Field label="Unit" value={p.unit} />
        <Field
          label="Track stock"
          value={p.trackStock ? <Badge tone="emerald">Yes</Badge> : <Badge tone="slate">No</Badge>}
        />
        <Field label="Cost (EX VAT)" value={usd(p.cost)} />
        <Field label="Sell price" value={usd(p.price)} />
        <Field label="GP margin" value={<span className="text-emerald-600">{gp.toFixed(1)}%</span>} />
        <Field label="Stock on hand" value={`${num(p.stock)} ${p.unit}`} />
        <Field label="Low stock alert" value={p.reorderLevel > 0 ? num(p.reorderLevel) : "—"} />
        <Field
          label="Status"
          value={
            p.stock <= 0 ? (
              <Badge tone="rose">Out of stock</Badge>
            ) : p.reorderLevel > 0 && p.stock <= p.reorderLevel ? (
              <Badge tone="amber">Low</Badge>
            ) : (
              <Badge tone="emerald">In stock</Badge>
            )
          }
        />
      </div>

      {/* Supplier */}
      <h4 className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
        <Truck size={14} /> Supplier
      </h4>
      {supplier ? (
        <div className="rounded-xl border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-ink-800">{supplier.name}</p>
              <p className="text-xs text-slate-400">{supplier.code}</p>
            </div>
            <Link href={`/purchase-orders?supplier=${encodeURIComponent(supplier.code)}`} className="btn-primary !px-3 !py-1.5 text-xs">
              <ClipboardList size={14} /> Order from this supplier
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            {supplier.contactPerson && <span>{supplier.contactPerson}</span>}
            {supplier.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} /> {supplier.phone}
              </span>
            )}
            {supplier.deliverySchedule && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={11} /> Delivers {supplier.deliverySchedule}
              </span>
            )}
            {(supplier.leadTime ?? 0) > 0 && <span>Lead time {supplier.leadTime}d</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Not linked to a supplier —{" "}
          <Link href="/suppliers" className="underline">
            link it
          </Link>{" "}
          so ordering knows where this comes from.
        </div>
      )}

      {/* Procurement history */}
      <h4 className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
        <PackageCheck size={14} /> Procurement history
      </h4>
      {poHistory.length === 0 && grnHistory.length === 0 ? (
        <p className="text-sm text-slate-400">No purchase orders or receipts yet for this product.</p>
      ) : (
        <div className="space-y-1.5">
          {poHistory.map(({ po, line }) => (
            <div
              key={po.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold text-ink-800">{po.poNo}</span>
                <span className="ml-2 text-xs text-slate-400">{shortDate(po.createdAt)}</span>
              </span>
              <span className="text-xs text-slate-500">
                ordered {line.qtyOrdered} · received{" "}
                <span className={line.qtyReceived >= line.qtyOrdered ? "text-emerald-600" : "text-amber-600"}>
                  {line.qtyReceived}
                </span>{" "}
                · {usd(line.cost)}/u
              </span>
            </div>
          ))}
          {grnHistory.map(({ g, line }) => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold text-ink-800">{g.grnNo}</span>
                <span className="ml-2 text-xs text-slate-400">{shortDate(g.createdAt)}</span>
              </span>
              <span className="text-xs text-emerald-700">+{line.qtyReceived} received</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
