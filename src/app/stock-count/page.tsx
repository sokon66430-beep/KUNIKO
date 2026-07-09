"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  Plus,
  ScanLine,
  Camera,
  Trash2,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  Calculator,
  Scale,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import type { Product, StockCount, StockCountItem } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { num, dateTime, usd } from "@/lib/format";

export default function StockCountPage() {
  const { data: counts, loading, error, reload } = useFetch<StockCount[]>("/api/stock-counts");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function newCount() {
    setCreating(true);
    try {
      const c = await api<StockCount>("/api/stock-counts", {
        method: "POST",
        body: JSON.stringify({}),
      });
      reload();
      setActiveId(c.id);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  }

  const list = counts || [];
  const openCount = list.filter((c) => c.status === "Open").length;
  const postedCount = list.filter((c) => c.status === "Posted").length;
  const lastNet = list[0]
    ? list[0].items.reduce((s, i) => s + (i.countedQty - i.systemQty), 0)
    : 0;

  return (
    <div>
      <PageHeader
        title="Stock Count"
        subtitle="Count the whole store, compare to system stock, then adjust — same-day counts share one report"
        actions={
          <button className="btn-primary" onClick={newCount} disabled={creating}>
            <Plus size={18} /> {creating ? "Opening…" : "Open Today's Count"}
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open Counts" value={num(openCount)} icon={<ClipboardCheck size={18} />} accent="amber" />
        <StatCard label="Completed" value={num(postedCount)} icon={<CheckCircle2 size={18} />} accent="emerald" />
        <StatCard label="Total Counts" value={num(list.length)} icon={<Calculator size={18} />} accent="brand" />
        <StatCard
          label="Latest Net Variance"
          value={`${lastNet >= 0 ? "+" : ""}${num(lastNet)}`}
          icon={<Scale size={18} />}
          accent={lastNet === 0 ? "brand" : "rose"}
        />
      </div>

      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading counts…" />
        ) : list.length === 0 ? (
          <EmptyState title="No stock counts yet" hint="Start a count, hand the Excel sheet to your accountant, then import it back." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Count</th>
                  <th className="px-4 py-3 font-semibold">Counted by</th>
                  <th className="px-4 py-3 text-center font-semibold">Items</th>
                  <th className="px-4 py-3 text-center font-semibold">Net Variance</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const net = c.items.reduce((s, i) => s + (i.countedQty - i.systemQty), 0);
                  return (
                    <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-800">{c.countNo}</p>
                        <p className="text-xs text-slate-400">{dateTime(c.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.countedBy}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{c.items.length}</td>
                      <td className={`px-4 py-3 text-center font-semibold ${net === 0 ? "text-slate-500" : net > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {net > 0 ? `+${net}` : net}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone={c.status === "Posted" ? "emerald" : "amber"}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/stock-counts/${c.id}/export`}
                            title="Download count sheet (Excel)"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50"
                          >
                            <FileSpreadsheet size={14} /> Excel
                          </a>
                          <button
                            onClick={() => setActiveId(c.id)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                          >
                            {c.status === "Posted" ? "View" : "Open"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {activeId && (
        <CountDetail
          id={activeId}
          onClose={() => {
            setActiveId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: count, reload } = useFetch<StockCount>(`/api/stock-counts/${id}`);
  const { data: products } = useFetch<Product[]>("/api/products");
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // A scanned product's row may only appear after the save round-trips, so we
  // re-try focusing its quantity box whenever the item list changes.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  const costOf = useMemo(() => new Map((products || []).map((p) => [p.id, p.cost])), [products]);

  const posted = count?.status === "Posted";
  const items = count?.items || [];

  useEffect(() => {
    if (!pendingFocus) return;
    const el = qtyRefs.current[pendingFocus];
    if (el) {
      el.focus();
      el.select();
      setPendingFocus(null);
    }
  }, [pendingFocus, items]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !products) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode || "").includes(q) ||
          p.sku.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [products, query]);

  async function setCounted(productId: string, countedQty: number) {
    await api(`/api/stock-counts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ productId, countedQty }] }),
    });
    setEdits((e) => {
      const n = { ...e };
      delete n[productId];
      return n;
    });
    reload();
  }

  async function addProduct(p: Product) {
    setQuery("");
    const existing = items.find((x) => x.productId === p.id);
    if (!existing) await setCounted(p.id, 0);
    setPendingFocus(p.id); // focus its qty box (now, or once the row appears)
  }

  // Barcode from the L3 scanner (types + Enter) or the phone camera. Matches on
  // barcode first, then Item ID / name, and drops the cursor into its qty box.
  function handleScan(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? query).trim();
    if (!code || !products) return;
    const lc = code.toLowerCase();
    const byBarcode = products.filter((p) => p.barcode === code);
    if (byBarcode.length > 1) {
      setNotice({ tone: "warn", text: `Barcode matches ${byBarcode.length} products — search by name` });
      if (!fromCamera) setQuery("");
      return;
    }
    const match =
      byBarcode[0] ||
      products.find((p) => p.sku.toLowerCase() === lc) ||
      products.find((p) => p.name.toLowerCase() === lc);
    if (match) {
      addProduct(match);
      setNotice({ tone: "ok", text: match.name });
    } else {
      setNotice({ tone: "warn", text: `Not found: ${code}` });
      if (!fromCamera) setQuery("");
    }
  }

  async function removeItem(productId: string) {
    await api(`/api/stock-counts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ productId, remove: true }] }),
    });
    reload();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/stock-counts/${id}/import`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setMsg(`Imported: ${data.added} added · ${data.updated} updated${data.skipped ? ` · ${data.skipped} skipped` : ""}`);
      reload();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function post() {
    if (!confirm("Post this count? Stock will be adjusted to the counted quantities.")) return;
    setBusy(true);
    try {
      await api(`/api/stock-counts/${id}/post`, { method: "POST" });
      onClose();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const netUnits = items.reduce((s, i) => s + (i.countedQty - i.systemQty), 0);
  const varValue = items.reduce((s, i) => s + (i.countedQty - i.systemQty) * (costOf.get(i.productId) || 0), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={count ? `${count.countNo} · Stock Count` : "Loading…"}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          {!posted && (
            <button className="btn-primary" disabled={busy || items.length === 0} onClick={post}>
              <CheckCircle2 size={16} /> {busy ? "Posting…" : "Post & adjust stock"}
            </button>
          )}
        </>
      }
    >
      {!count ? (
        <Spinner label="Loading count…" />
      ) : (
        <>
          {/* Full-store count via Excel — the primary way to count everything */}
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-ink-700">
              Full store count · {num(products?.length || 0)} products
              <span className="ml-2 font-normal text-slate-500">
                {items.length} counted so far
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/stock-counts/${id}/export`} className="btn-ghost !py-1.5 text-xs">
                <FileSpreadsheet size={15} /> Download count sheet (all products)
              </a>
              {!posted && (
                <>
                  <button className="btn-ghost !py-1.5 text-xs" disabled={importing} onClick={() => fileRef.current?.click()}>
                    <Upload size={15} /> {importing ? "Importing…" : "Import counted sheet"}
                  </button>
                  <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImportFile} />
                </>
              )}
              {posted && <Badge tone="emerald">Posted · stock adjusted</Badge>}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              The sheet lists every product with its system stock. Fill the yellow “Counted Qty” column, then import it back.
            </p>
          </div>
          {msg && (
            <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">{msg}</div>
          )}

          {/* Scan (L3 / phone camera) or search to count on screen */}
          {!posted && (
            <div className="mb-4">
              <label className="label flex items-center gap-1.5">
                <ScanLine size={13} /> Scan barcode or search product
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
                  <input
                    ref={scanRef}
                    className="input pl-10 pr-12"
                    placeholder="Scan with L3 / phone, or type name · barcode · Item ID…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
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
                  {searchResults.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-soft">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addProduct(p)}
                          className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3.5 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink-800">{p.name}</span>
                            <span className="text-[11px] text-slate-400">{p.barcode || p.sku} · on hand {p.stock}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">count</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {notice && (
                  <span
                    className={`chip whitespace-nowrap ${
                      notice.tone === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {notice.text}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400">Scan an item, then type the counted amount — Enter jumps back to scan the next.</p>
            </div>
          )}

          {/* Counted items */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 text-center font-semibold">System</th>
                  <th className="px-3 py-2 text-center font-semibold">Counted</th>
                  <th className="px-3 py-2 text-center font-semibold">Variance</th>
                  <th className="px-3 py-2 font-semibold">Counted by</th>
                  {!posted && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const shown = edits[it.productId] ?? String(it.countedQty);
                  const v = (Number(shown) || 0) - it.systemQty;
                  return (
                    <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-ink-800">{it.name}</p>
                        <p className="text-xs text-slate-400">
                          {it.sku}
                          {it.barcode ? ` · ${it.barcode}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-400">{it.systemQty}</td>
                      <td className="px-3 py-2 text-center">
                        {posted ? (
                          <span className="font-semibold text-ink-800">{it.countedQty}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            ref={(el) => {
                              qtyRefs.current[it.productId] = el;
                            }}
                            value={shown}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setEdits((ed) => ({ ...ed, [it.productId]: e.target.value }))}
                            onBlur={() => setCounted(it.productId, Math.max(0, Number(shown) || 0))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                                scanRef.current?.focus(); // ready for the next scan
                              }
                            }}
                            className="mx-auto block w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                          />
                        )}
                      </td>
                      <td className={`px-3 py-2 text-center font-semibold ${v === 0 ? "text-slate-400" : v > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {v > 0 ? `+${v}` : v}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{it.countedBy || "—"}</td>
                      {!posted && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeItem(it.productId)}
                            className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={posted ? 5 : 6} className="px-3 py-10 text-center text-sm text-slate-400">
                      <ClipboardCheck className="mx-auto mb-2 text-slate-300" size={22} />
                      Nothing counted yet. Scan items above, or download the sheet, fill it, and import.
                    </td>
                  </tr>
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50">
                    <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {items.length} item{items.length === 1 ? "" : "s"} counted
                    </td>
                    <td></td>
                    <td className="px-3 py-2.5 text-center text-xs font-semibold uppercase text-slate-500">Net</td>
                    <td className={`px-3 py-2.5 text-center font-bold ${netUnits === 0 ? "text-slate-500" : netUnits > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                      {netUnits > 0 ? `+${netUnits}` : netUnits}
                    </td>
                    <td></td>
                    {!posted && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {items.length > 0 && (
            <p className="mt-2 text-right text-xs text-slate-500">
              Variance value ≈ <b className={varValue < 0 ? "text-rose-600" : "text-emerald-600"}>{usd(varValue)}</b> (at cost)
            </p>
          )}

          <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => handleScan(code)} />
        </>
      )}
    </Modal>
  );
}
