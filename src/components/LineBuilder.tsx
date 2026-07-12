"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Search, Trash2, Sparkles, X, Camera } from "lucide-react";
import type { Product } from "@/lib/types";
import { usd } from "@/lib/format";
import { useFetch } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";

export type Line = { product: Product; qty: number };

export type Suggestion = {
  productId: string;
  suggestedQty: number;
};

// Sales velocity per product (from /api/product-velocity): units sold in the
// last 3 and 7 days, plus a per-weekday tally (Mon..Sun) over the last 4 weeks.
type Velocity = { d3: number; d7: number; dow: number[] };
const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

// Recommended order quantity: enough to cover `coverDays` days of recent sales
// (daily rate from the last 7 days), minus what's on hand. Falls back to the
// reorder-level gap when there's no recent sales data.
function recommendQty(p: Product, v: Velocity | undefined, coverDays: number): number {
  if (v && v.d7 > 0) {
    const target = Math.ceil((v.d7 / 7) * coverDays);
    return Math.max(target - p.stock, 1);
  }
  if (p.reorderLevel > 0) return Math.max(p.reorderLevel * 2 - p.stock, 1);
  return 1;
}

// Compact sales-performance readout for one order line: last 3d / 7d units sold,
// units on hand, and a tiny Mon..Sun bar chart (today highlighted).
function SalesMini({ v, stock }: { v?: Velocity; stock: number }) {
  const d3 = v?.d3 ?? 0;
  const d7 = v?.d7 ?? 0;
  const dow = v?.dow ?? [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(1, ...dow);
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 .. Sun=6
  const noData = d7 === 0 && dow.every((n) => n === 0);
  return (
    <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1 text-[11px] text-slate-500">
      <span>
        Sold <b className="text-ink-700">3d {d3}</b> · <b className="text-ink-700">7d {d7}</b>
      </span>
      <span className="text-slate-400">on hand {stock}</span>
      {noData ? (
        <span className="text-slate-300">no recent sales</span>
      ) : (
        <span className="flex items-end gap-[3px]" title="Units sold per weekday (last 4 weeks)">
          {dow.map((n, i) => (
            <span key={i} className="flex w-3 flex-col items-center">
              <span className="text-[9px] leading-none text-slate-400">{n}</span>
              <span
                className={`mt-0.5 block w-2 rounded-sm ${i === todayIdx ? "bg-brand-500" : "bg-slate-300"}`}
                style={{ height: `${3 + Math.round((n / max) * 12)}px` }}
              />
              <span
                className={`text-[9px] leading-none ${i === todayIdx ? "font-bold text-brand-600" : "text-slate-400"}`}
              >
                {DOW_LABELS[i]}
              </span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export function LineBuilder({
  products,
  lines,
  setLines,
  suggestions,
}: {
  products: Product[];
  lines: Line[];
  setLines: (updater: (prev: Line[]) => Line[]) => void;
  suggestions?: Suggestion[];
}) {
  const [scan, setScan] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<Product[] | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const { data: velocity } = useFetch<Record<string, Velocity>>("/api/product-velocity");
  // How many days of sales the recommendation should cover — the user picks.
  const [coverDays, setCoverDays] = useState(7);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // After a product is added, jump the cursor into ITS quantity box so the qty
  // must be set before moving to the next item. The tick forces a re-focus even
  // when the same product is scanned again.
  const [focusQty, setFocusQty] = useState<{ id: string; tick: number } | null>(null);

  useEffect(() => {
    if (!focusQty) return;
    const el = qtyRefs.current[focusQty.id];
    if (el) {
      el.focus();
      el.select();
    }
  }, [focusQty]);

  // Keep the scan box focused on open so a handheld (L#) scanner works instantly
  // — the operator never has to tap the field first.
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function addProduct(p: Product, qty?: number, focus = true) {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        // Re-scan bumps by 1 (or an explicit qty); a new line defaults to the
        // recommended order quantity based on sales velocity.
        const updated = { ...existing, qty: existing.qty + (qty ?? 1) };
        // Manual scan/search → move the touched item to the TOP so the newest is
        // always the first row. Batch autofill (focus=false) keeps its order.
        if (!focus) return prev.map((l) => (l.product.id === p.id ? updated : l));
        return [updated, ...prev.filter((l) => l.product.id !== p.id)];
      }
      const newQty = qty ?? recommendQty(p, velocity?.[p.id], coverDays);
      return focus ? [{ product: p, qty: newQty }, ...prev] : [...prev, { product: p, qty: newQty }];
    });
    if (focus) setFocusQty((f) => ({ id: p.id, tick: (f?.tick || 0) + 1 }));
  }

  // codeArg comes from the camera scanner; without it we read the text box.
  function handleScan(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? scan).trim();
    if (!code) return;
    const lc = code.toLowerCase();
    // Some barcodes in the master are shared by 2+ products (data re-listing) —
    // never silently guess which one; make the picker resolve it.
    const byBarcode = products.filter((p) => p.barcode === code);
    if (byBarcode.length > 1) {
      setAmbiguous(byBarcode);
      setNotice(null);
      if (!fromCamera) setScan("");
      return;
    }
    const match =
      byBarcode[0] ||
      products.find((p) => p.sku.toLowerCase() === lc) ||
      products.find((p) => p.name.toLowerCase() === lc);
    if (match) {
      addProduct(match); // moves item to top + focuses its qty box
      setNotice({ tone: "ok", text: `Added ${match.name}` });
      if (!fromCamera) setScan(""); // clear text; cursor is now in the qty box
    } else if (!fromCamera && scanSuggestions.length > 0) {
      // Partial input with live suggestions showing — keep the text so the
      // dropdown stays open and the user can pick from it.
      setNotice({ tone: "warn", text: "No exact match — pick from the suggestions" });
    } else {
      setNotice({ tone: "warn", text: fromCamera ? `Not in this list: ${code}` : `No product for “${code}”` });
      if (!fromCamera) {
        setScan("");
        scanRef.current?.focus();
      }
    }
  }

  function resolveAmbiguous(p: Product) {
    addProduct(p);
    setNotice({ tone: "ok", text: `Added ${p.name}` });
    setAmbiguous(null);
    scanRef.current?.focus();
  }

  // When the caller has already scoped the catalog to something manageable
  // (e.g. one supplier's ~300 products), let ops browse it without typing —
  // the full 3,800+ product catalog stays search-only (never browsable).
  const browsable = products.length > 0 && products.length <= 400;

  // Search recommends across name, barcode, SKU, supplier and category —
  // ranked so the most likely intent (name match) surfaces first.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!browsable) return [];
      return [...products].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
    }
    const score = (p: Product) => {
      const name = p.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      if ((p.barcode || "").includes(q)) return 2;
      if (p.sku.toLowerCase().includes(q)) return 3;
      if (p.supplier.toLowerCase().includes(q)) return 4;
      if (p.category.toLowerCase().includes(q)) return 5;
      return -1;
    };
    return products
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, 40)
      .map((x) => x.p);
  }, [products, query, browsable]);

  // Live recommendations while typing in the scan box — partial barcode/SKU
  // first, then product-name matches. A real scanner sends the full code +
  // Enter instantly, so these only appear during manual typing.
  const scanSuggestions = useMemo(() => {
    const q = scan.trim();
    if (q.length < 3) return [];
    const ql = q.toLowerCase();
    const score = (p: Product) => {
      if ((p.barcode || "").includes(q)) return 0;
      if (p.sku.toLowerCase().includes(ql)) return 1;
      const name = p.name.toLowerCase();
      if (name.startsWith(ql)) return 2;
      if (name.includes(ql)) return 3;
      return -1;
    };
    return products
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, 8)
      .map((x) => x.p);
  }, [products, scan]);

  function pickScanSuggestion(p: Product) {
    addProduct(p); // focuses the new item's qty box
    setNotice({ tone: "ok", text: `Added ${p.name}` });
    setScan("");
  }

  function autofillLowStock() {
    if (!suggestions?.length) return;
    let added = 0;
    for (const s of suggestions) {
      const p = byId.get(s.productId);
      if (p && s.suggestedQty > 0) {
        addProduct(p, s.suggestedQty, false);
        added++;
      }
    }
    setNotice({ tone: "ok", text: `Added ${added} low-stock item${added === 1 ? "" : "s"}` });
  }

  const total = lines.reduce((s, l) => s + l.product.cost * l.qty, 0);

  return (
    <div className="space-y-4">
      {/* Scan + search row */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label flex items-center gap-1.5">
            <ScanLine size={13} /> Scan barcode / Item ID
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
            <input
              ref={scanRef}
              className="input pl-10 pr-12"
              placeholder="Scan, type, or tap the camera"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan();
                }
              }}
            />
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              title="Scan with camera"
              className="absolute right-1.5 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100"
            >
              <Camera size={17} />
            </button>
            {scanSuggestions.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-soft">
                {scanSuggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickScanSuggestion(p)}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3.5 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink-800">{p.name}</span>
                      <span className="text-[11px] text-slate-400">{p.barcode || p.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{usd(p.cost)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            <Search size={13} /> {browsable && !query.trim() ? "Browse products" : "Search product"}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="input pl-10"
              placeholder={browsable ? "Browse below or type to narrow…" : "Name, barcode, supplier or category…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-soft">
                {!query.trim() && browsable && products.length > searchResults.length && (
                  <p className="border-b border-slate-100 bg-slate-50 px-3.5 py-1.5 text-[11px] text-slate-400">
                    Showing {searchResults.length} of {products.length} — type to narrow
                  </p>
                )}
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      addProduct(p); // to top + focuses its qty box
                      setQuery(""); // close the dropdown; ready for the next search
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3.5 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink-800">{p.name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {p.barcode && <span>{p.barcode}</span>}
                        {p.barcode ? " · " : ""}
                        {p.supplier !== "—" ? `${p.supplier} · ` : ""}
                        {p.category}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{usd(p.cost)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {ambiguous && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            This barcode matches {ambiguous.length} products — pick the correct one:
          </p>
          <div className="flex flex-wrap gap-2">
            {ambiguous.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => resolveAmbiguous(p)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:bg-amber-100"
              >
                <span className="font-semibold text-ink-800">{p.name}</span>
                <span className="ml-1.5 text-slate-400">{p.sku}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmbiguous(null)}
              className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-rose-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* The buyer chooses how many days the recommendation should cover. */}
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
          <span className="text-xs font-semibold text-slate-500">Recommend for:</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {[3, 7, 14, 30].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCoverDays(n)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                  coverDays === n ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {n}d
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            value={coverDays}
            onChange={(e) => setCoverDays(Math.max(1, Number(e.target.value) || 1))}
            className="h-7 w-14 rounded-lg border border-slate-200 bg-white px-1.5 text-center text-xs font-bold text-ink-900 outline-none focus:border-brand-500"
            title="Days of sales the recommended quantity should cover"
          />
          <span className="text-xs text-slate-400">days of sales</span>
        </div>
        {suggestions && suggestions.length > 0 && (
          <button type="button" onClick={autofillLowStock} className="btn-ghost !py-2 text-xs">
            <Sparkles size={14} /> Auto-fill {suggestions.length} low-stock
          </button>
        )}
        {notice && (
          <span
            className={`chip ${
              notice.tone === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {notice.text}
          </span>
        )}
      </div>

      {/* Lines */}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-right font-semibold">Cost</th>
              <th className="px-3 py-2 text-center font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Line</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.product.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2">
                  <p className="font-semibold text-ink-800">{l.product.name}</p>
                  <p className="text-xs text-slate-400">
                    {l.product.sku} · {l.product.supplier}
                  </p>
                  <SalesMini v={velocity?.[l.product.id]} stock={l.product.stock} />
                </td>
                <td className="px-3 py-2 text-right text-slate-500">{usd(l.product.cost)}</td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={1}
                    ref={(el) => {
                      qtyRefs.current[l.product.id] = el;
                    }}
                    value={l.qty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((x) =>
                          x.product.id === l.product.id
                            ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) }
                            : x,
                        ),
                      )
                    }
                    onKeyDown={(e) => {
                      // Enter confirms the qty and returns to the scan box for the next item.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        scanRef.current?.focus();
                      }
                    }}
                    className="mx-auto block w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                  {(() => {
                    const rec = recommendQty(l.product, velocity?.[l.product.id], coverDays);
                    return rec === l.qty ? (
                      <p className="mt-1 text-center text-[10px] font-semibold text-emerald-600">✓ Rec {rec}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) =>
                            prev.map((x) => (x.product.id === l.product.id ? { ...x, qty: rec } : x)),
                          )
                        }
                        title="Apply the recommended quantity"
                        className="mx-auto mt-1 block text-[10px] font-semibold text-brand-600 hover:underline"
                      >
                        Rec {rec} ↺
                      </button>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-ink-800">
                  {usd(l.product.cost * l.qty)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}
                    className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">
                  <ScanLine className="mx-auto mb-2 text-slate-300" size={22} />
                  Scan or search to add items.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-100 bg-slate-50">
                <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500" colSpan={2}>
                  {lines.length} line{lines.length === 1 ? "" : "s"} ·{" "}
                  {lines.reduce((s, l) => s + l.qty, 0)} units
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Total</td>
                <td className="px-3 py-2.5 text-right font-bold text-ink-900">{usd(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => handleScan(code)} />
    </div>
  );
}

export function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-slate-400 hover:text-rose-500">
      <X size={13} className="mr-1 inline" />
      Clear
    </button>
  );
}
