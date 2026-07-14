"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  Plus,
  ScanLine,
  Camera,
  Trash2,
  FileSpreadsheet,
  FileType2,
  Upload,
  CheckCircle2,
  Calculator,
  Scale,
  MapPin,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import { PdfViewer } from "@/components/PdfViewer";
import { COUNT_PLACES, type Product, type StockCount, type StockCountItem, type CountPlace } from "@/lib/types";

// "Store 12 · Vault 5" — the per-place breakdown of a counted item.
function formatPlaces(it: StockCountItem): string {
  if (!it.placeQty) return "";
  return COUNT_PLACES.filter((pl) => it.placeQty![pl]).map((pl) => `${pl} ${it.placeQty![pl]}`).join(" · ");
}
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { confirmDialog } from "@/components/confirm";
import { num, dateTime, usd } from "@/lib/format";

export default function StockCountPage() {
  const { data: counts, loading, error, reload } = useFetch<StockCount[]>("/api/stock-counts");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StockCount | null>(null);
  const [pdfView, setPdfView] = useState<{ url: string; title: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  // Open a count sheet's PDF inside the app so it can be viewed and printed here.
  async function openPdf(c: StockCount) {
    setPdfLoading(c.id);
    try {
      const res = await fetch(`/api/stock-counts/${c.id}/export?format=pdf`);
      const blob = await res.blob();
      setPdfView({ url: URL.createObjectURL(blob), title: c.countNo });
    } catch {
      alert("Could not open the PDF.");
    } finally {
      setPdfLoading(null);
    }
  }
  function closePdf() {
    if (pdfView) URL.revokeObjectURL(pdfView.url);
    setPdfView(null);
  }

  // Combined report = every count summed into one. Open its PDF in-app.
  async function openCombinedPdf() {
    setPdfLoading("combined");
    try {
      const res = await fetch(`/api/stock-counts/combined/export?format=pdf`);
      const blob = await res.blob();
      setPdfView({ url: URL.createObjectURL(blob), title: "— Combined Report" });
    } catch {
      alert("Could not open the PDF.");
    } finally {
      setPdfLoading(null);
    }
  }

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

  // Sort + "Today" quick filter for the counts list (default: newest first).
  const [sortBy, setSortBy] = useState<"date-desc" | "date-asc" | "no">("date-desc");
  const [todayOnly, setTodayOnly] = useState(false);
  const hasAnyCounts = (counts || []).length > 0;
  const isToday = (iso: string) => {
    const c = new Date(iso);
    const n = new Date();
    return c.getFullYear() === n.getFullYear() && c.getMonth() === n.getMonth() && c.getDate() === n.getDate();
  };
  const list = useMemo(() => {
    let l = [...(counts || [])];
    if (todayOnly) l = l.filter((c) => isToday(c.createdAt));
    switch (sortBy) {
      case "date-asc":
        return l.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      case "no":
        return l.sort((a, b) => a.countNo.localeCompare(b.countNo));
      default:
        return l.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    }
  }, [counts, sortBy, todayOnly]);
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

      {/* Combined report — sums every count into one, right above the list */}
      {hasAnyCounts && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              <ClipboardCheck size={16} /> {todayOnly ? "Today" : "All counts"}
            </h2>
            {/* Today quick filter — click to show only what was counted today */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {[
                { key: false, label: "All" },
                { key: true, label: "Today" },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setTodayOnly(o.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    todayOnly === o.key ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              Sort by
              <SearchSelect
                className="w-44"
                value={sortBy}
                onChange={(v) => setSortBy(v as any)}
                options={[
                  { value: "date-desc", label: "Date · newest first" },
                  { value: "date-asc", label: "Date · oldest first" },
                  { value: "no", label: "Count number" },
                ]}
              />
            </div>
            <a
              href="/api/stock-counts/combined/export?format=xlsx"
              className="btn-ghost !py-2 text-sm"
              title="Excel — every count summed into one report"
            >
              <FileSpreadsheet size={16} /> Combined Excel
            </a>
            <button
              className="btn-ghost !py-2 text-sm"
              disabled={pdfLoading === "combined"}
              onClick={openCombinedPdf}
              title="PDF — every count summed into one report"
            >
              <FileType2 size={16} /> {pdfLoading === "combined" ? "Opening…" : "Combined PDF"}
            </button>
          </div>
        </div>
      )}

      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading counts…" />
        ) : list.length === 0 ? (
          todayOnly ? (
            <EmptyState title="Nothing counted today" hint="Switch to “All” to see earlier counts, or open today’s count to start." />
          ) : (
            <EmptyState title="No stock counts yet" hint="Start a count, hand the Excel sheet to your accountant, then import it back." />
          )
        ) : (
          <div>
            {list.map((c) => {
              const net = c.items.reduce((s, i) => s + (i.countedQty - i.systemQty), 0);
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
                >
                  <div className="min-w-0 cursor-pointer" onClick={() => setActiveId(c.id)}>
                    <p className="font-semibold text-ink-900">
                      {c.countNo}
                      <span className="ml-2 text-xs font-normal text-slate-400">{dateTime(c.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {c.countedBy} · {c.items.length} item{c.items.length === 1 ? "" : "s"} ·{" "}
                      <span className={`font-semibold ${net === 0 ? "text-slate-500" : net > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {net > 0 ? `+${net}` : net} variance
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={c.status === "Posted" ? "emerald" : "amber"}>{c.status}</Badge>
                    <div className="flex items-center gap-1">
                      <a
                        href={`/api/stock-counts/${c.id}/export`}
                        title="Download count sheet (Excel)"
                        className="grid h-8 w-8 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                      >
                        <FileSpreadsheet size={15} />
                      </a>
                      <button
                        onClick={() => openPdf(c)}
                        disabled={pdfLoading === c.id}
                        title="View / print count sheet (PDF)"
                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <FileType2 size={15} />
                      </button>
                      <button
                        onClick={() => setActiveId(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-100"
                      >
                        {c.status === "Posted" ? "View" : "Open"}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        title="Delete count (needs manager approval)"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {pdfView && <PdfViewer url={pdfView.url} title={pdfView.title} heading={`Stock Count ${pdfView.title}`} onClose={closePdf} />}

      {activeId && (
        <CountDetail
          id={activeId}
          onClose={() => {
            setActiveId(null);
            reload();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteApproveModal
          count={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={() => {
            setDeleteTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// Deleting a stock count is destructive, so it requires a manager / assistant
// manager to approve it by entering their code (same approvers as elsewhere).
function DeleteApproveModal({
  count,
  onClose,
  onDone,
}: {
  count: StockCount;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/stock-counts/${count.id}`, { method: "DELETE", body: JSON.stringify({ code }) });
      onDone();
    } catch (e: any) {
      setErr(e.message || "Could not delete this count");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete stock count"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn bg-rose-600 font-bold text-white hover:bg-rose-700"
            disabled={busy || !code.trim()}
            onClick={submit}
          >
            {busy ? "Deleting…" : "Approve & delete"}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        You're about to permanently delete <span className="font-semibold text-ink-900">{count.countNo}</span> (
        {count.items.length} item{count.items.length === 1 ? "" : "s"}). A manager must approve this.
      </p>
      <label className="label mt-4">Manager approval code</label>
      <input
        className="input tracking-widest"
        type="password"
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter approval code"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      {err && <p className="mt-2 text-xs font-medium text-rose-600">{err}</p>}
      <p className="mt-2 text-xs text-slate-400">
        Ask a Manager or Assistant Manager to enter their code. Codes are managed in Store Settings.
      </p>
    </Modal>
  );
}

function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: count, reload } = useFetch<StockCount>(`/api/stock-counts/${id}`);
  const { data: products } = useFetch<Product[]>("/api/products");
  const [query, setQuery] = useState("");
  // Where the counter is standing right now — every scan is tagged with this
  // place (Store / Stock / Vault) so the report shows where it was counted.
  const [place, setPlace] = useState<CountPlace>("Store");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // After each scan we pop up an amount prompt for that product. The same
  // product often sits in several places (shelf front, stockroom…), so a
  // re-scan ADDS to what's already counted — staff just count what's in
  // front of them and the app keeps the running total.
  const [countTarget, setCountTarget] = useState<Product | null>(null);
  const [countValue, setCountValue] = useState("");
  const [alreadyCounted, setAlreadyCounted] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Track scan order so the most-recently-counted item floats to the top row.
  const [scanOrder, setScanOrder] = useState<Record<string, number>>({});
  const seqRef = useRef(0);
  const [pdfView, setPdfView] = useState<{ url: string; title: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  async function openPdf() {
    if (!count) return;
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/stock-counts/${count.id}/export?format=pdf`);
      const blob = await res.blob();
      setPdfView({ url: URL.createObjectURL(blob), title: count.countNo });
    } catch {
      alert("Could not open the PDF.");
    } finally {
      setPdfLoading(false);
    }
  }
  function closePdf() {
    if (pdfView) URL.revokeObjectURL(pdfView.url);
    setPdfView(null);
  }

  const costOf = useMemo(() => new Map((products || []).map((p) => [p.id, p.cost])), [products]);

  const posted = count?.status === "Posted";
  const items = count?.items || [];
  const displayItems = useMemo(() => {
    const idx = new Map(items.map((it, i) => [it.productId, i] as const));
    return [...items].sort((a, b) => {
      const oa = scanOrder[a.productId];
      const ob = scanOrder[b.productId];
      if (oa != null && ob != null) return ob - oa;
      if (oa != null) return -1;
      if (ob != null) return 1;
      return (idx.get(a.productId) ?? 0) - (idx.get(b.productId) ?? 0);
    });
  }, [items, scanOrder]);

  useEffect(() => {
    if (countTarget) {
      promptRef.current?.focus();
      promptRef.current?.select();
    }
  }, [countTarget]);

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

  // patch = either { countedQty } (set absolute — manual edit) or
  // { addQty } (add this spot's count — a scan; the server sums it so two
  // people scanning the same product at once both count).
  async function writeCount(
    productId: string,
    patch: { countedQty: number } | { addQty: number; place: CountPlace },
  ) {
    seqRef.current += 1;
    const s = seqRef.current;
    setScanOrder((o) => ({ ...o, [productId]: s })); // this item floats to the top
    await api(`/api/stock-counts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ productId, ...patch }] }),
    });
    setEdits((e) => {
      const n = { ...e };
      delete n[productId];
      return n;
    });
    reload();
  }
  const setCounted = (productId: string, countedQty: number) => writeCount(productId, { countedQty });

  // Scan/pick a product → pop up the amount prompt. If it was counted before
  // (another shelf / the stockroom), the new amount ADDS to the running total.
  function promptCount(p: Product) {
    setQuery("");
    setNotice(null);
    const existing = items.find((x) => x.productId === p.id);
    setAlreadyCounted(existing ? existing.countedQty : 0);
    setCountValue(""); // always type just what's in front of you
    setCountTarget(p);
  }

  async function confirmCount() {
    if (!countTarget) return;
    const p = countTarget;
    const seen = Math.max(0, Number(countValue) || 0);
    setCountTarget(null);
    setCountValue("");
    // Send the delta with the current place — the server adds it and tags it.
    await writeCount(p.id, { addQty: seen, place });
    setNotice({
      tone: "ok",
      text:
        alreadyCounted > 0
          ? `${p.name} — +${seen} in ${place}, total ${alreadyCounted + seen}`
          : `${p.name} — counted ${seen} in ${place}`,
    });
    scanRef.current?.focus(); // ready for the next scan
  }

  function cancelPrompt() {
    setCountTarget(null);
    setCountValue("");
    scanRef.current?.focus();
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
      if (fromCamera) setCameraOpen(false); // reveal the amount prompt
      promptCount(match);
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
    if (
      !(await confirmDialog({
        title: "Post stock count",
        message: "Post this count? Stock will be adjusted to the counted quantities.",
        confirmText: "Post count",
        tone: "brand",
      }))
    )
      return;
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
    <>
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
              <button className="btn-ghost !py-1.5 text-xs" disabled={pdfLoading} onClick={openPdf}>
                <FileType2 size={15} /> {pdfLoading ? "Opening…" : "View / Print PDF"}
              </button>
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

          {/* Amount prompt — appears right after a scan */}
          {!posted && countTarget && (
            <div className="mb-4 rounded-xl border-2 border-brand-400 bg-brand-50 p-4 shadow-soft">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                {alreadyCounted > 0 ? "Count this spot — it adds to the total" : "Enter counted amount"}
              </p>
              <p className="mt-0.5 truncate text-[15px] font-bold text-ink-900">{countTarget.name}</p>
              <p className="text-xs text-slate-500">
                {countTarget.barcode || countTarget.sku} · system stock {countTarget.stock}
                {alreadyCounted > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-brand-700">already counted {alreadyCounted}</span>
                  </>
                )}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  ref={promptRef}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={countValue}
                  onChange={(e) => setCountValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmCount();
                    } else if (e.key === "Escape") {
                      cancelPrompt();
                    }
                  }}
                  placeholder="0"
                  className="w-28 rounded-xl border border-brand-300 bg-white px-3 py-2.5 text-center text-xl font-bold tabular-nums outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                />
                <button className="btn-primary" onClick={confirmCount}>
                  <CheckCircle2 size={16} /> Save
                </button>
                <button className="btn-ghost" onClick={cancelPrompt}>
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {alreadyCounted > 0 ? (
                  <>
                    Type only what you see in this spot — new total will be{" "}
                    <b className="text-brand-700">{alreadyCounted + Math.max(0, Number(countValue) || 0)}</b>. To fix a
                    mistake, edit the number in the list below instead.
                  </>
                ) : (
                  "Type the amount and press Enter — then scan the next item."
                )}
              </p>
            </div>
          )}

          {/* Where are you counting? — set before scanning; every scan is tagged */}
          {!posted && (
            <div className="mb-3">
              <label className="label flex items-center gap-1.5">
                <MapPin size={13} /> Where are you counting?
              </label>
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {COUNT_PLACES.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    onClick={() => setPlace(pl)}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                      place === pl ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    {pl}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Everything you scan now is recorded as counted in <b className="text-brand-600">{place}</b>. Switch when
                you move to another area.
              </p>
            </div>
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
                          onClick={() => promptCount(p)}
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
              <p className="mt-1 text-xs text-slate-400">
                Scan an item → type what you see → Enter. Scan it again at another spot (shelf, stockroom…) and the
                amounts add up automatically.
              </p>
            </div>
          )}

          {/* Counted items */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Place</th>
                  <th className="px-3 py-2 text-center font-semibold">System</th>
                  <th className="px-3 py-2 text-center font-semibold">Counted</th>
                  <th className="px-3 py-2 text-center font-semibold">Variance</th>
                  <th className="px-3 py-2 font-semibold">Counted by</th>
                  {!posted && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {displayItems.map((it) => {
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
                      <td className="px-3 py-2 text-xs text-slate-500">{formatPlaces(it) || "—"}</td>
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
                    <td colSpan={posted ? 6 : 7} className="px-3 py-10 text-center text-sm text-slate-400">
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
    {pdfView && (
      <PdfViewer url={pdfView.url} title={pdfView.title} heading={`Stock Count ${pdfView.title}`} onClose={closePdf} />
    )}
    </>
  );
}
