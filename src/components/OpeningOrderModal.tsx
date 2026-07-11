"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X, Trash2, ClipboardList } from "lucide-react";
import { api } from "@/lib/client";
import type { Product } from "@/lib/types";
import { num } from "@/lib/format";

// Stock a new store — order best sellers from your other stores. Pick how many
// SKUs, adjust quantities, then create one Purchase Order per supplier.
type OpenRow = { sku: string; name: string; supplier: string; category: string; units: number; qty: number };

export function OpeningOrderModal({
  products,
  onClose,
  onDone,
}: {
  products: Product[];
  onClose: () => void;
  onDone: () => void;
}) {
  // 0 = ALL best sellers, no cap.
  const [count, setCount] = useState<number>(50);
  const [rows, setRows] = useState<OpenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku, p])), [products]);
  const presets: { label: string; value: number }[] = [
    { label: "25", value: 25 },
    { label: "50", value: 50 },
    { label: "100", value: 100 },
    { label: "200", value: 200 },
    { label: "500", value: 500 },
    { label: "All", value: 0 },
  ];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(count > 0 ? `/api/cross-store-bestsellers?limit=${count}` : "/api/cross-store-bestsellers")
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        setRows(
          (res.items || []).map((it: any) => ({
            sku: it.sku,
            name: it.name,
            supplier: bySku.get(it.sku)?.supplier || "—",
            category: it.category || "",
            units: it.units || 0,
            qty: it.recommendedQty || 1,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [count, bySku]);

  const totalUnits = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const supplierCount = new Set(rows.map((r) => r.supplier)).size;

  function setQty(sku: string, qty: number) {
    setRows((rs) => rs.map((r) => (r.sku === sku ? { ...r, qty } : r)));
  }
  function removeRow(sku: string) {
    setRows((rs) => rs.filter((r) => r.sku !== sku));
  }

  async function create() {
    const items = rows.filter((r) => (Number(r.qty) || 0) > 0).map((r) => ({ sku: r.sku, qty: Number(r.qty) || 0 }));
    if (items.length === 0) {
      alert("Nothing to order — set at least one quantity.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ created: { poNo: string; supplier: string; items: number }[] }>(
        "/api/purchase-orders/opening",
        { method: "POST", body: JSON.stringify({ items, note: note.trim() || undefined }) },
      );
      const n = res.created.length;
      alert(`Created ${n} purchase order${n === 1 ? "" : "s"} across ${n} supplier${n === 1 ? "" : "s"} (${items.length} items).`);
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-600" />
            <div>
              <h3 className="text-base font-bold text-ink-900">Stock a new store</h3>
              <p className="text-[11px] text-slate-500">Best sellers from your other stores — grouped into one PO per supplier</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={17} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">How many SKUs (top sellers):</span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setCount(p.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${count === p.value ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              value={count || ""}
              placeholder="All"
              onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-center text-sm font-semibold outline-none focus:border-brand-500"
              title="Type any number — leave empty for ALL"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="grid h-40 place-items-center text-sm text-slate-400">Finding best sellers…</div>
          ) : rows.length === 0 ? (
            <div className="grid h-40 place-items-center px-6 text-center text-sm text-slate-400">
              No sales history in your other stores yet — nothing to recommend. Import some sales first.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold">Supplier</th>
                    <th className="px-3 py-2 text-right font-semibold">Sold</th>
                    <th className="px-3 py-2 text-center font-semibold">Order Qty</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sku} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink-800">{r.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {r.sku} · {r.category}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.supplier}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{num(r.units)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={r.qty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setQty(r.sku, Math.max(0, Number(e.target.value) || 0))}
                          className="mx-auto block w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm font-semibold outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeRow(r.sku)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <input
            className="input mb-3 text-sm"
            placeholder="Note on these POs (optional) — e.g. ON Mart TK st.592 opening"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-500">
              {num(rows.length)} SKUs · {num(totalUnits)} units · {num(supplierCount)} supplier{supplierCount === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || rows.length === 0} onClick={create}>
                <ClipboardList size={16} /> {busy ? "Creating…" : "Create Purchase Orders"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
