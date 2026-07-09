"use client";

import { useState } from "react";
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

  // Typing a supplier name that matches the Supplier master links the
  // product to it (supplierCode); otherwise it's saved as free text and
  // flagged, so the master doesn't silently drift.
  const linkedSupplier = suppliers.find((s) => s.name === form.supplier);
  function setSupplierText(name: string) {
    const match = suppliers.find((s) => s.name === name);
    // "" (not undefined) so an unlink actually reaches the PATCH body —
    // JSON.stringify drops undefined-valued keys entirely.
    setForm((f) => ({ ...f, supplier: name, supplierCode: match?.code || "" }));
  }

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
          <button className="btn-primary" disabled={busy || !form.name} onClick={() => onSave(form)}>
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
            className="input bg-slate-50 tracking-[0.2em] text-slate-500"
            value={initial.id ? form.sku || "" : idPreview}
            readOnly
          />
          <p className="mt-1 text-xs text-slate-400">
            {initial.id
              ? "The Item ID stays fixed once created."
              : "Auto-generated on save · 2 digits of sub-group + category code + a unique number = 8 digits."}
          </p>
        </div>
        <div className="col-span-2">
          <label className="label">Category</label>
          <input className="input" value={form.category || ""} onChange={(e) => set("category", e.target.value)} />
        </div>
        <div>
          <label className="label">Supplier</label>
          <input
            className="input"
            list="supplier-master-list"
            value={form.supplier || ""}
            onChange={(e) => setSupplierText(e.target.value)}
            placeholder="Start typing to match a supplier…"
          />
          <datalist id="supplier-master-list">
            {suppliers.map((s) => (
              <option key={s.code} value={s.name} />
            ))}
          </datalist>
          {form.supplier && !linkedSupplier && (
            <p className="mt-1 text-xs text-amber-600">
              Not linked to a supplier record — add it in{" "}
              <a href="/suppliers" className="underline">
                Suppliers
              </a>{" "}
              for accurate ordering.
            </p>
          )}
        </div>
        <div>
          <label className="label">Unit</label>
          <input className="input" value={form.unit || ""} onChange={(e) => set("unit", e.target.value)} />
        </div>
        <div>
          <label className="label">Cost ($)</label>
          <input className="input" type="number" step="0.01" value={form.cost ?? 0} onChange={(e) => set("cost", e.target.value)} />
        </div>
        <div>
          <label className="label">Price ($)</label>
          <input className="input" type="number" step="0.01" value={form.price ?? 0} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div>
          <label className="label">Stock</label>
          <input className="input" type="number" value={form.stock ?? 0} onChange={(e) => set("stock", e.target.value)} />
        </div>
        <div>
          <label className="label">Low stock alert</label>
          <input className="input" type="number" value={form.reorderLevel ?? 0} onChange={(e) => set("reorderLevel", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
