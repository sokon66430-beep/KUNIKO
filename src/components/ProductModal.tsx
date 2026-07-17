"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Truck, Tag, Sparkles, Upload, Image as ImageIcon, X } from "lucide-react";
import type { Product, Supplier, SellingUnit } from "@/lib/types";
import { Modal } from "@/components/ui";
import { Select } from "@/components/Select";
import { itemIdPrefix } from "@/lib/itemId";
import { defaultShowOnPos } from "@/lib/pos";
import { normalizeUnit, unitDimension } from "@/lib/units";
import { baseUnitName } from "@/lib/sellingUnits";

// What a convenience store actually stacks. A fixed list rather than a text box
// so "Case" and "case" can't become two different things, with the sizes a shop
// usually means pre-filled. "Custom…" keeps the door open for a shop that says
// "Tray" — the spec asks for unlimited packaging levels, not four.
const UNIT_PRESETS: { name: string; conversion: number }[] = [
  { name: "Pack", conversion: 6 },
  { name: "Box", conversion: 12 },
  { name: "Carton", conversion: 24 },
  { name: "Case", conversion: 24 },
];
const CUSTOM = "__custom";
const PRESET_NAMES = UNIT_PRESETS.map((p) => p.name);

/**
 * The packaging levels above the base unit.
 *
 * The base level is deliberately not editable here — it IS the product's own
 * unit/price/barcode above. Showing it as a row would invite someone to give the
 * same product two prices for the same thing.
 */
function SellingUnitsEditor({
  units,
  baseName,
  basePrice,
  onChange,
}: {
  units: SellingUnit[];
  baseName: string;
  basePrice: number;
  onChange: (units: SellingUnit[]) => void;
}) {
  const update = (index: number, patch: Partial<SellingUnit>) =>
    onChange(units.map((u, i) => (i === index ? { ...u, ...patch } : u)));

  function add() {
    // Start on the first packaging that isn't taken, at the size it usually
    // means — the row lands filled in and correct, and the dropdown is there to
    // change it. Falls back to a blank custom row once the presets are used up.
    const preset = UNIT_PRESETS.find((p) => !units.some((u) => u.name === p.name));
    const conversion = preset?.conversion || 0;
    onChange([
      ...units,
      {
        id: `su${Date.now()}${units.length}`,
        name: preset?.name || "",
        conversion,
        // Seed the price from the base so it's a sane starting point, not $0 —
        // a shop can then discount the multipack, which is the usual reason to
        // have one.
        price: conversion > 0 ? Math.round(basePrice * conversion * 100) / 100 : 0,
        active: true,
      },
    ]);
  }

  return (
    <div className="col-span-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-bold text-ink-900">Selling units</p>
        <p className="text-[11px] text-slate-400">
          Stock always counts in {baseName.toLowerCase()}s — these only change how it&apos;s scanned and priced.
        </p>
      </div>
      <p className="mb-3 text-[11.5px] text-slate-500">
        Add a pack or a case and give it its own barcode; scanning it sells that whole packaging and takes the right
        number of {baseName.toLowerCase()}s off the shelf.
      </p>

      {/* The base level, shown but not editable. It IS this product's own unit,
          price and barcode from the fields above — an editable row here would
          let the same thing carry two prices. Listing it keeps the table honest:
          Unit = 1, Pack = 6, Case = 24. */}
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-black text-slate-500">
          1
        </span>
        <span className="flex-1 text-[13px] font-semibold text-ink-900">{baseName}</span>
        <span className="text-[12px] tabular-nums text-slate-500">${basePrice.toFixed(2)}</span>
        <span className="text-[11px] text-slate-400">set above · always 1</span>
      </div>

      {units.length > 0 && (
        <div className="mb-3 space-y-2">
          {units.map((u, i) => (
            <div key={u.id} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[7rem] flex-1">
                  <label className="label !mb-1 !text-[10px]">Unit name</label>
                  <Select
                    value={PRESET_NAMES.includes(u.name) ? u.name : CUSTOM}
                    onChange={(v) => {
                      if (v === CUSTOM) {
                        update(i, { name: "" });
                        return;
                      }
                      // Picking a name fills in the size it usually means — but
                      // only when nothing's been typed yet, so choosing "Case"
                      // never silently rewrites a 30 someone entered on purpose.
                      const preset = UNIT_PRESETS.find((p) => p.name === v)!;
                      const conversion = u.conversion || preset.conversion;
                      update(i, {
                        name: v,
                        conversion,
                        price: u.price || Math.round(basePrice * conversion * 100) / 100,
                      });
                    }}
                    options={[
                      ...UNIT_PRESETS.filter(
                        (p) => p.name === u.name || !units.some((x) => x.name === p.name),
                      ).map((p) => ({ value: p.name, label: p.name, description: `usually ${p.conversion}` })),
                      { value: CUSTOM, label: "Custom…", description: "any other packaging" },
                    ]}
                  />
                  {!PRESET_NAMES.includes(u.name) && (
                    <input
                      value={u.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder="Tray, Bundle…"
                      className="input !mt-1.5 !py-1.5 text-[13px]"
                    />
                  )}
                </div>
                <div className="w-24">
                  <label className="label !mb-1 !text-[10px]">= how many</label>
                  <input
                    value={u.conversion || ""}
                    onChange={(e) => update(i, { conversion: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                    inputMode="numeric"
                    placeholder="24"
                    className="input !py-1.5 text-right text-[13px] font-semibold tabular-nums"
                  />
                </div>
                <div className="w-24">
                  <label className="label !mb-1 !text-[10px]">Price</label>
                  <input
                    value={u.price || ""}
                    onChange={(e) => update(i, { price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                    inputMode="decimal"
                    placeholder="10.50"
                    className="input !py-1.5 text-right text-[13px] font-semibold tabular-nums"
                  />
                </div>
                <div className="min-w-[8rem] flex-1">
                  <label className="label !mb-1 !text-[10px]">Barcode</label>
                  <input
                    value={u.barcode || ""}
                    onChange={(e) => update(i, { barcode: e.target.value.trim() })}
                    placeholder="scan or type"
                    className="input !py-1.5 font-mono text-[12px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onChange(units.filter((_, x) => x !== i))}
                  className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!u.isDefault}
                    onChange={(e) =>
                      // Only one level can be the default, so picking this one
                      // clears the others rather than saving an invalid set.
                      onChange(units.map((x, xi) => ({ ...x, isDefault: xi === i ? e.target.checked : false })))
                    }
                    className="h-3.5 w-3.5 accent-brand-600"
                  />
                  Default at the till
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={u.active !== false}
                    onChange={(e) => update(i, { active: e.target.checked })}
                    className="h-3.5 w-3.5 accent-brand-600"
                  />
                  Active
                </label>
                {u.conversion > 1 && u.price > 0 && (
                  <span className="text-[11.5px] text-slate-400">
                    1 {u.name || "unit"} = {u.conversion} {baseName.toLowerCase()}s · $
                    {(u.price / u.conversion).toFixed(3)} each
                    {basePrice > 0 && (
                      <span
                        className={
                          u.price / u.conversion <= basePrice ? " font-semibold text-emerald-600" : " font-semibold text-amber-600"
                        }
                      >
                        {" "}
                        {u.price / u.conversion <= basePrice
                          ? `· ${Math.round((1 - u.price / u.conversion / basePrice) * 100)}% cheaper than singles`
                          : "· dearer than singles"}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-brand-600 ring-1 ring-slate-200 transition hover:ring-brand-300"
      >
        + Add packaging level
      </button>
    </div>
  );
}

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
  categories = [],
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Product>;
  suppliers: Supplier[];
  categories?: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (p: Partial<Product>) => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(initial);
  const set = (k: keyof Product, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const photoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Downscale before upload — a POS tile never needs more than ~512px, and the
  // master carries thousands of products.
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
      set("image", d.name);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

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

  // Category: searchable dropdown of existing categories. Picking an existing
  // one avoids typos/duplicates; typing a brand-new one is allowed (there's no
  // separate category master to add to), but flagged so it's a deliberate choice.
  const cleanCategories = useMemo(
    () => Array.from(new Set(categories.filter((c) => c && c !== "All" && c !== "Uncategorized"))).sort(),
    [categories],
  );
  const [catOpen, setCatOpen] = useState(false);
  const catTyped = (form.category || "").trim();
  const linkedCategory = cleanCategories.some((c) => c.toLowerCase() === catTyped.toLowerCase());
  const isNewCategory = !!catTyped && !linkedCategory;
  const catMatches = useMemo(() => {
    const q = catTyped.toLowerCase();
    const base = q ? cleanCategories.filter((c) => c.toLowerCase().includes(q)) : cleanCategories;
    return base.slice(0, 10);
  }, [cleanCategories, catTyped]);

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
        <div className="relative col-span-2">
          <label className="label">Category</label>
          <input
            className={`input ${linkedCategory ? "pr-8" : ""}`}
            value={form.category || ""}
            onFocus={() => setCatOpen(true)}
            onBlur={() => setTimeout(() => setCatOpen(false), 150)}
            onChange={(e) => {
              set("category", e.target.value);
              setCatOpen(true);
            }}
            placeholder="Search a category…"
          />
          {linkedCategory && (
            <Check size={15} className="pointer-events-none absolute right-3 top-[34px] text-emerald-500" />
          )}
          {catOpen && catMatches.length > 0 && (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
              {catMatches.map((c) => {
                const active = c.toLowerCase() === catTyped.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      set("category", c);
                      setCatOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left last:border-0 ${
                      active ? "bg-brand-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                      <Tag size={12} />
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? "font-semibold text-brand-700" : "font-medium text-ink-800"}`}>
                      {c}
                    </span>
                    {active && <Check size={14} className="shrink-0 text-brand-600" />}
                  </button>
                );
              })}
            </div>
          )}
          {isNewCategory && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600">
              <Sparkles size={12} /> New category — “{catTyped}” doesn’t exist yet. Pick from the list to avoid duplicates,
              or keep it to create a new one.
            </p>
          )}
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
          <p className="mt-1 text-[11px] text-slate-400">
            {unitDimension(form.unit)
              ? `Stock is counted in ${normalizeUnit(form.unit)} — recipes convert to it automatically.`
              : "Recipes can't use this product until its unit is one of: g, kg, ml, L, pcs, unit, pack, box."}
          </p>
        </div>
        {/* Pack/box only convert for products counted in pieces — a "pack" of a
            product measured in kg has no meaning, so we don't ask. */}
        {unitDimension(form.unit) === "count" && (
          <>
            <div>
              <label className="label">Pieces per pack</label>
              <input
                className="input"
                inputMode="numeric"
                value={form.packSize ?? ""}
                onChange={(e) => set("packSize", Number(e.target.value.replace(/[^\d]/g, "")) || undefined)}
                placeholder="e.g. 10"
              />
            </div>
            <div>
              <label className="label">Pieces per box</label>
              <input
                className="input"
                inputMode="numeric"
                value={form.boxSize ?? ""}
                onChange={(e) => set("boxSize", Number(e.target.value.replace(/[^\d]/g, "")) || undefined)}
                placeholder="e.g. 24"
              />
            </div>
          </>
        )}
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
          <Select
            value={form.ranking || "A"}
            onChange={(v) => set("ranking", v)}
            options={["A", "B", "C", "D"].map((r) => ({ value: r, label: r }))}
          />
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
        {/* Product photo — shown on the POS tile so the cashier spots fresh
            items fast. Nothing to do with the supplier-invoice photos. */}
        <div className="col-span-2">
          <label className="label">Photo — shown on the POS</label>
          <div className="flex items-center gap-3">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {form.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/product-image/${form.image}`} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon size={20} className="text-slate-300" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost !py-2 text-sm"
                disabled={uploading}
                onClick={() => photoRef.current?.click()}
              >
                <Upload size={15} /> {uploading ? "Uploading…" : form.image ? "Change photo" : "Add photo"}
              </button>
              {form.image && (
                <button
                  type="button"
                  className="btn-ghost !py-2 text-sm text-rose-600"
                  onClick={() => set("image", undefined)}
                >
                  Remove
                </button>
              )}
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickPhoto(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        {/* Which products the cashier can TAP at the till. Everything else is
            sold by scanning its barcode and never shows on the POS screen. */}
        <label className="col-span-2 flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-ink-800">Show on POS</span>
            <span className="block text-[11px] leading-relaxed text-slate-400">
              Cashier taps this item at the till (fresh food, made-to-order drinks). Leave off for items sold by
              scanning the barcode.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.showOnPos ?? defaultShowOnPos(form.category || "")}
            onChange={(e) => set("showOnPos", e.target.checked)}
            className="h-5 w-5 shrink-0 accent-brand-600"
          />
        </label>

        <SellingUnitsEditor
          units={form.sellingUnits || []}
          baseName={baseUnitName({ unit: form.unit || "" })}
          basePrice={priceN}
          onChange={(units) => set("sellingUnits", units.length ? units : undefined)}
        />

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
