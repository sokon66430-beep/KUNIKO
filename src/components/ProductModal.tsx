"use client";

import { useMemo, useState } from "react";
import { Check, Truck } from "lucide-react";
import type { Product, Supplier } from "@/lib/types";
import { Modal } from "@/components/ui";
import { itemIdPrefix } from "@/lib/itemId";

export const EMPTY_PRODUCT: Partial<Product> = {
  name: "",
  sku: "",
  subGroupCode: "",
  catCode: "",
  barcode: "",
  category: "",
  supplier: "",
  supplierCode: undefined,
  ranking: "A",
  unit: "U",
  cost: 0,
  price: 0,
  stock: 0,
  reorderLevel: 0,
};

export function ProductModal({
  initial,
  suppliers,
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Product>;
  suppliers: Supplier[];
  busy: boolean;
  onClose: () => void;
  onSave: (p: Partial<Product>) => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(initial);
  const set = (k: keyof Product, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Live preview of the auto-generated Item ID: the fixed prefix from the
  // codes, with the running number shown as dots (filled in on save).
  const prefix = itemIdPrefix(form.subGroupCode, form.catCode);
  const idPreview = prefix ? prefix + "•".repeat(8 - prefix.length) : "auto";

  // Gross profit with VAT: the sell price includes 10% VAT, so GP is figured on
  // the ex-VAT price.  GP% = (price/1.1 − cost) / (price/1.1) × 100
  const costN = Number(form.cost) || 0;
  const priceN = Number(form.price) || 0;
  const exVat = priceN / 1.1;
  const profit = exVat - costN;
  const gp = priceN > 0 ? (profit / exVat) * 100 : null;

  // Typing a supplier name that matches the Supplier master links the
  // product to it (supplierCode); otherwise it's saved as free text and
  // flagged, so the master doesn't silently drift.
  const linkedSupplier = suppliers.find((s) => s.name === form.supplier);
  const [supplierOpen, setSupplierOpen] = useState(false);
  // A typed supplier that isn't a real record blocks Save — you must add it in
  // Suppliers first. Legacy products whose supplier is unchanged pass through so
  // unrelated edits (price, stock…) never get stuck.
  const supplierTyped = !!(form.supplier && form.supplier.trim() && form.supplier !== "—");
  const supplierBlocked = supplierTyped && !linkedSupplier && form.supplier !== initial.supplier;
  function setSupplierText(name: string) {
    const match = suppliers.find((s) => s.name === name);
    // "" (not undefined) so an unlink actually reaches the PATCH body —
    // JSON.stringify drops undefined-valued keys entirely.
    setForm((f) => ({ ...f, supplier: name, supplierCode: match?.code || "" }));
  }
  function pickSupplier(s: Supplier) {
    setForm((f) => ({ ...f, supplier: s.name, supplierCode: s.code }));
    setSupplierOpen(false);
  }
  const supplierMatches = useMemo(() => {
    const q = (form.supplier || "").trim().toLowerCase();
    const base = q
      ? suppliers.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      : suppliers;
    return base.slice(0, 8);
  }, [suppliers, form.supplier]);

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? "Edit Product" : "Add Product"}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || !form.name || supplierBlocked}
            onClick={() => onSave(form)}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Product name</label>
          <input className="input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Product name (Khmer) — for price labels</label>
          <input
            className="input"
            value={form.nameKh || ""}
            onChange={(e) => set("nameKh", e.target.value)}
            placeholder="ឈ្មោះទំនិញជាភាសាខ្មែរ"
          />
        </div>
        <div>
          <label className="label">Barcode</label>
          <input
            className="input"
            value={form.barcode || ""}
            onChange={(e) => set("barcode", e.target.value)}
            placeholder="8851959132014"
          />
        </div>
        <div>
          <label className="label">Sub-group code</label>
          <input
            className="input"
            inputMode="numeric"
            value={form.subGroupCode || ""}
            onChange={(e) => set("subGroupCode", e.target.value)}
            placeholder="e.g. 33"
          />
        </div>
        <div>
          <label className="label">Category code</label>
          <input
            className="input"
            inputMode="numeric"
            value={form.catCode || ""}
            onChange={(e) => set("catCode", e.target.value)}
            placeholder="e.g. 118"
          />
        </div>
        <div className="col-span-2">
          <label className="label">Item ID</label>
          <input
            className="input tracking-[0.15em]"
            value={form.sku || ""}
            onChange={(e) => set("sku", e.target.value)}
            placeholder={idPreview === "auto" ? "auto — or type your own" : `${idPreview}  ·  or type your own`}
          />
          <p className="mt-1 text-xs text-slate-400">
            Type your own Item ID to match your existing codes, or leave blank to auto‑generate
            {idPreview === "auto" ? "" : ` (${idPreview})`} from the sub‑group + category codes.
          </p>
        </div>
        <div className="col-span-2">
          <label className="label">Category</label>
          <input className="input" value={form.category || ""} onChange={(e) => set("category", e.target.value)} />
        </div>
        <div className="relative">
          <label className="label">Supplier</label>
          <input
            className={`input ${linkedSupplier ? "pr-8" : ""}`}
            value={form.supplier || ""}
            onFocus={() => setSupplierOpen(true)}
            onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
            onChange={(e) => {
              setSupplierText(e.target.value);
              setSupplierOpen(true);
            }}
            placeholder="Search supplier name or code…"
          />
          {linkedSupplier && (
            <Check size={15} className="pointer-events-none absolute right-3 top-[34px] text-emerald-500" />
          )}
          {supplierOpen && supplierMatches.length > 0 && (
            <div className="absolute z-30 mt-1 max-h-56 w-[130%] min-w-full overflow-y-auto rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
              {supplierMatches.map((s) => {
                const active = s.code === form.supplierCode;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSupplier(s);
                    }}
                    className={`flex w-full items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left last:border-0 ${
                      active ? "bg-brand-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                      <Truck size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12.5px] ${active ? "font-semibold text-brand-700" : "font-medium text-ink-800"}`}>{s.name}</span>
                      <span className="block text-[10.5px] text-slate-400">{s.code}</span>
                    </span>
                    {active && <Check size={14} className="shrink-0 text-brand-600" />}
                  </button>
                );
              })}
            </div>
          )}
          {supplierBlocked && (
            <p className="mt-1 text-xs font-medium text-rose-600">
              “{form.supplier}” isn’t a supplier in the system. Pick one from the list, or add it in{" "}
              <a href="/suppliers" className="underline">
                Suppliers
              </a>{" "}
              first — you can’t save until it’s a real supplier.
            </p>
          )}
        </div>
        <div>
          <label className="label">Unit</label>
          <input className="input" value={form.unit || ""} onChange={(e) => set("unit", e.target.value)} />
        </div>
        <div>
          <label className="label">Product group (A01–A05)</label>
          <input
            className="input"
            value={form.groupCode || ""}
            onChange={(e) => set("groupCode", e.target.value.toUpperCase())}
            placeholder="e.g. A04"
          />
        </div>
        <div>
          <label className="label">Product ranking</label>
          <select className="input" value={form.ranking || "A"} onChange={(e) => set("ranking", e.target.value)}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </select>
        </div>
        <div>
          <label className="label">Shelf life (days)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={form.shelfLifeDays ?? ""}
            onChange={(e) => set("shelfLifeDays", e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="e.g. 180"
          />
        </div>
        <div>
          <label className="label">Cost ($)</label>
          <input className="input" type="number" step="0.01" value={form.cost ?? 0} onChange={(e) => set("cost", e.target.value)} />
        </div>
        <div>
          <label className="label">Price ($)</label>
          <input className="input" type="number" step="0.01" value={form.price ?? 0} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="col-span-2 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Gross Profit · VAT 10% incl.</p>
            <p className="text-[11px] text-slate-400">
              Price ex‑VAT ${exVat.toFixed(2)} · profit ${profit.toFixed(2)}/unit
            </p>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${gp != null && gp < 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {gp == null ? "—" : `${gp.toFixed(1)}%`}
          </p>
        </div>
        <div>
          <label className="label">Stock</label>
          <input className="input" type="number" value={form.stock ?? 0} onChange={(e) => set("stock", e.target.value)} />
        </div>
        <div>
          <label className="label">Low stock alert</label>
          <input className="input" type="number" value={form.reorderLevel ?? 0} onChange={(e) => set("reorderLevel", e.target.value)} />
        </div>
        <div>
          <label className="label">Gondola / Aisle</label>
          <input
            className="input"
            value={form.gondola || ""}
            onChange={(e) => set("gondola", e.target.value)}
            placeholder="e.g. A12"
          />
        </div>
        <div>
          <label className="label">Shelf</label>
          <input
            className="input"
            value={form.shelf || ""}
            onChange={(e) => set("shelf", e.target.value)}
            placeholder="e.g. 3"
          />
        </div>
      </div>
    </Modal>
  );
}
