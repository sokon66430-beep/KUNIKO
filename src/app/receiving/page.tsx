"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { splitBarcodeField } from "@/lib/barcodes";
import {
  PackageCheck,
  Truck,
  ScanLine,
  History,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Camera,
  FileType2,
  Search,
  X,
  ArrowRight,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import { InvoiceCamera } from "@/components/InvoiceCamera";
import type { PurchaseOrder } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { num, usd, dateTime, shortDate } from "@/lib/format";

/**
 * Receiving — the deliveries still to be counted in.
 *
 * The receipt history lives at /receipts. They used to share this page and its
 * scroll, so a store with many open POs scrolled past all of them to reach the
 * receipts; and the page fetched BOTH lists, so either job paid for the other's
 * data. This page now loads purchase orders only.
 */
export default function ReceivingPage() {
  const { data: pos, loading, error, reload } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  // Search the open POs by PO number, supplier or source PR — for stores with
  // many open orders to receive.
  const [poSearch, setPoSearch] = useState("");
  // Supplier invoices scanned on each PO card (held here until the receipt is
  // confirmed, then sent with it). Keyed by PO id.
  const [invoiceByPo, setInvoiceByPo] = useState<Record<string, string[]>>({});
  const [invoiceCamPo, setInvoiceCamPo] = useState<string | null>(null);

  // A PO whose receiving is CLOSED (invoice submitted) is done — it leaves this
  // list even if its quantity status is still Open/Partial.
  const openPOs = (pos || []).filter((p) => (p.status === "Open" || p.status === "Partial") && !p.receivingClosed);
  const poQuery = poSearch.trim().toLowerCase();
  const shownPOs = poQuery
    ? openPOs.filter(
        (p) =>
          p.poNo.toLowerCase().includes(poQuery) ||
          p.supplier.toLowerCase().includes(poQuery) ||
          (p.prNo || "").toLowerCase().includes(poQuery),
      )
    : openPOs;
  const partial = openPOs.filter((p) => p.status === "Partial").length;
  const unitsOutstanding = openPOs.reduce(
    (s, p) => s + p.items.reduce((t, i) => t + Math.max(0, i.qtyOrdered - i.qtyReceived), 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title="Goods Receiving"
        subtitle="Scan supplier deliveries against a PO — stock updates on every scan"
        actions={
          <Link href="/receipts" className="btn-ghost">
            <History size={16} /> Receipt history <ArrowRight size={15} />
          </Link>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting Delivery" value={num(openPOs.length)} icon={<Truck size={18} />} accent="amber" />
        <StatCard
          label="Partially Received"
          value={num(partial)}
          sub={partial ? "some of the order still owed" : undefined}
          icon={<AlertTriangle size={18} />}
          accent="rose"
        />
        <StatCard
          label="Units Outstanding"
          value={num(unitsOutstanding)}
          sub="still to arrive"
          icon={<ClipboardList size={18} />}
          accent="brand"
        />
        <StatCard
          label="Lines to Receive"
          value={num(openPOs.reduce((s, p) => s + p.items.filter((i) => i.qtyReceived < i.qtyOrdered).length, 0))}
          icon={<PackageCheck size={18} />}
          accent="emerald"
        />
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <Truck size={16} /> Open Purchase Orders
          {openPOs.length > 0 && <span className="font-semibold normal-case text-slate-400">({num(shownPOs.length)})</span>}
        </h2>
        {openPOs.length > 0 && (
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              className="input pl-9 !py-2 text-sm"
              placeholder="Search PO number or supplier…"
              value={poSearch}
              onChange={(e) => setPoSearch(e.target.value)}
              inputMode="search"
              autoComplete="off"
            />
            {poSearch && (
              <button
                type="button"
                onClick={() => setPoSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <Card>
          <Spinner label="Loading deliveries…" />
        </Card>
      ) : openPOs.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to receive" hint="All purchase orders are fully received." />
        </Card>
      ) : shownPOs.length === 0 ? (
        <Card>
          <EmptyState title="No matching PO" hint={`No open purchase order matches “${poSearch}”.`} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shownPOs.map((po) => {
            const ordered = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
            const received = po.items.reduce((s, i) => s + Math.min(i.qtyReceived, i.qtyOrdered), 0);
            const pct = ordered ? Math.round((received / ordered) * 100) : 0;
            const invoicePageCount = invoiceByPo[po.id]?.length || 0;
            const hasInvoice = invoicePageCount > 0;
            return (
              <div key={po.id} className="card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-ink-900">{po.poNo}</p>
                    <p className="truncate text-xs text-slate-400" title={po.supplier}>{po.supplier}</p>
                  </div>
                  <Badge tone={po.status === "Partial" ? "amber" : "brand"}>{po.status}</Badge>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${pct > 0 ? "bg-amber-500" : "bg-slate-300"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {received}/{ordered}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock size={12} className="shrink-0 text-slate-400" /> Ordered {dateTime(po.createdAt)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {po.items.length} line{po.items.length === 1 ? "" : "s"}
                  {po.expectedDate ? ` · due ${shortDate(po.expectedDate)}` : ""}
                </p>
                {/* Step 1: scan the supplier invoice · Step 2: receive the goods */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInvoiceCamPo(po.id)}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      hasInvoice
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {hasInvoice ? <CheckCircle2 size={14} /> : <Camera size={14} />}
                    {hasInvoice ? "Invoice ✓" : "Scan Invoice"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiving(po)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700"
                  >
                    <ScanLine size={14} /> Receive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}


      {receiving && (
        <ReceiveModal
          po={receiving}
          invoicePages={invoiceByPo[receiving.id] || []}
          onScanInvoice={() => setInvoiceCamPo(receiving.id)}
          onClose={() => setReceiving(null)}
          onDone={() => {
            const doneId = receiving.id;
            setReceiving(null);
            setInvoiceByPo((prev) => {
              const n = { ...prev };
              delete n[doneId];
              return n;
            });
            reload();
          }}
        />
      )}
    </div>
  );
}

function ReceiveModal({
  po,
  invoicePages,
  onScanInvoice,
  onClose,
  onDone,
}: {
  po: PurchaseOrder;
  invoicePages: string[]; // supplier invoice pages scanned on the PO card
  onScanInvoice: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  // qty being received in THIS session, keyed by productId.
  //
  // Starts at ZERO for every line — nothing has been counted yet. Defaulting to
  // the outstanding quantity meant the form arrived pre-filled with a full
  // delivery, so Confirm would book in goods nobody had checked, or that were
  // never on the truck. The receiver adds what actually turned up, by scanning
  // it or typing it; what wasn't received stays 0 and the PO stays open for it.
  const initial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of po.items) m[it.productId] = 0;
    return m;
  }, [po]);
  const [now, setNow] = useState<Record<string, number>>(initial);
  // What's typed in each line's "Add" box, before it's banked into the total.
  // Kept as a string so the field can be empty or mid-type without React
  // fighting the cursor.
  const [addBox, setAddBox] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  // "Received by" is always the signed-in user — recorded automatically, not editable.
  const { data: session } = useFetch<{ user?: { name?: string } }>("/api/auth/session");
  const receivedBy = session?.user?.name || "—";
  const [flash, setFlash] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<typeof po.items | null>(null);
  const [busy, setBusy] = useState(false);
  // The live camera can be turned off — closing it stops the camera and gives
  // the whole screen to the list (staff who scan with a handheld gun or type
  // don't need it). It starts on, the way most people receive.
  const [cameraOn, setCameraOn] = useState(true);
  // Two-step confirm: "Confirm receipt" opens a REVIEW of everything counted
  // (with short/over flags) so it can be checked against the invoice; only the
  // review's "Submit receipt" actually posts and moves stock.
  const [reviewing, setReviewing] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Scan order: the just-scanned item floats to the TOP row and its quantity box
  // gets focus, so the amount is confirmed/adjusted before the next scan.
  const [scanOrder, setScanOrder] = useState<Record<string, number>>({});
  const seq = useRef(0);
  const [focusQty, setFocusQty] = useState<{ id: string; tick: number } | null>(null);

  useEffect(() => {
    if (!focusQty) return;
    const el = qtyRefs.current[focusQty.id];
    if (el) {
      el.focus();
      el.select();
    }
  }, [focusQty]);

  // Auto-focus the scan box so a handheld (L#) scanner works immediately.
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  /**
   * Bank the typed amount onto the line's running total.
   *
   * ADDS — never replaces. The same item routinely arrives as several boxes, and
   * each one is its own entry: scan a box, type what's in it, scan the next,
   * type that. Replacing would silently drop everything counted before it.
   *
   * `backToScan` is false on blur — clicking straight into another line's box
   * shouldn't yank focus back to the scanner.
   */
  function applyAdd(productId: string, backToScan = true) {
    const raw = addBox[productId];
    const n = Math.floor(Number(raw) || 0);
    if (n > 0) {
      setNow((p) => ({ ...p, [productId]: (p[productId] || 0) + n }));
    }
    setAddBox((p) => ({ ...p, [productId]: "" }));
    if (n > 0 && backToScan) scanRef.current?.focus();
  }

  function bump(productId: string, name: string) {
    // A scan identifies the item and jumps focus straight to its quantity box —
    // it does NOT add anything on its own. The receiver scans a box, then keys in
    // how many are in it (the number is added to the line's running total). This
    // way "scan → type 24" records 24, not 25.
    seq.current += 1;
    const s = seq.current;
    setScanOrder((o) => ({ ...o, [productId]: s }));
    setFlash({ tone: "ok", text: `${name} — key in the quantity` });
    setFocusQty({ id: productId, tick: s });
  }

  // Scanned items first (most-recent on top), then the rest in original PO order.
  const orderedItems = useMemo(() => {
    const idx = new Map(po.items.map((it, i) => [it.productId, i] as const));
    return [...po.items].sort((a, b) => {
      const oa = scanOrder[a.productId];
      const ob = scanOrder[b.productId];
      if (oa != null && ob != null) return ob - oa;
      if (oa != null) return -1;
      if (ob != null) return 1;
      return (idx.get(a.productId) ?? 0) - (idx.get(b.productId) ?? 0);
    });
  }, [po.items, scanOrder]);

  // codeArg comes from the camera scanner; otherwise read the text box.
  function handleScan(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? scan).trim();
    if (!code) return;
    const lc = code.toLowerCase();
    // Scan matches the physical barcode first (what's actually on the box);
    // fall back to SKU/name for manual entry. A barcode shared by 2+ lines
    // on the same PO is rare but must not silently pick the wrong one.
    // A PO line snapshots the product's barcode as it was when the order was
    // raised — and an order raised before the multi-code repair (or one frozen
    // by "sent") can still hold the old "A,B" field. Split it here so the box
    // in the receiver's hands still scans either way. See lib/barcodes.
    const byBarcode = po.items.filter((i) => splitBarcodeField(i.barcode).includes(code));
    if (byBarcode.length > 1) {
      setAmbiguous(byBarcode);
      setFlash(null);
      if (!fromCamera) setScan("");
      return;
    }
    const line = byBarcode[0] || po.items.find((i) => i.sku.toLowerCase() === lc || i.name.toLowerCase() === lc);
    if (line) {
      bump(line.productId, line.name);
      if (!fromCamera) setScan(""); // bump() moves focus into the item's qty box
    } else {
      setFlash({ tone: "warn", text: `“${code}” not on this PO` });
      if (!fromCamera) {
        setScan("");
        scanRef.current?.focus();
      }
    }
  }

  function resolveAmbiguous(item: (typeof po.items)[number]) {
    bump(item.productId, item.name);
    setAmbiguous(null);
    scanRef.current?.focus();
  }

  async function confirm() {
    const items = po.items
      .map((it) => ({ productId: it.productId, qtyReceived: now[it.productId] || 0 }))
      .filter((x) => x.qtyReceived > 0);
    if (items.length === 0) {
      setFlash({ tone: "warn", text: "Enter at least one quantity" });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ items, receivedBy, invoices: invoicePages }),
      });
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const totalNow = Object.values(now).reduce((s, v) => s + (Number(v) || 0), 0);
  // Money value of everything being received now — the figure to match against
  // the supplier invoice's grand total.
  const totalAmount = po.items.reduce((s, it) => s + it.cost * (now[it.productId] || 0), 0);

  return (
    <Modal
      open
      fullScreen
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      onClose={onClose}
      title={`Receive · ${po.poNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || totalNow === 0}
            title={totalNow === 0 ? "Enter at least one quantity first" : "Review everything before it's posted"}
            onClick={() => setReviewing(true)}
          >
            <CheckCircle2 size={16} /> Review receipt (+{totalNow})
          </button>
        </>
      }
    >
      {/* Top ~30% — a live camera. Point it at a box; the item jumps to the top
          of the list and its quantity box takes focus, so the count can be keyed
          in straight away. Staff can hide it (stops the camera, frees the whole
          screen) and bring it back any time. */}
      {cameraOn ? (
        <div className="relative h-[30vh] shrink-0 border-b border-slate-200 bg-black">
          <CameraScanner variant="inline" open onClose={() => {}} onScan={(code) => handleScan(code)} />
          <button
            type="button"
            onClick={() => setCameraOn(false)}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/70"
          >
            <X size={13} /> Hide camera
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCameraOn(true)}
          className="flex shrink-0 items-center justify-center gap-2 border-b border-slate-200 bg-slate-50 py-2.5 text-[13px] font-semibold text-brand-600 transition hover:bg-slate-100"
        >
          <Camera size={16} /> Show camera scanner
        </button>
      )}

      {/* Bottom ~70% — the work area scrolls under the fixed camera. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <p className="mb-3 text-sm text-slate-500">
          Supplier <b className="text-ink-700">{po.supplier}</b> · scan each item above, then key in the quantity.
          Stock updates on confirm.
        </p>

        {/* Manual entry — for a handheld scanner gun, or typing the code/quantity
            by hand when the camera can't get a read. */}
        <div className="mb-4">
          <label className="label flex items-center gap-1.5">
            <ScanLine size={13} /> Or type the barcode / Item ID
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
              <input
                ref={scanRef}
                className="input pl-10"
                placeholder="Scan with a handheld, or type the code"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan();
                  }
                }}
              />
            </div>
            {flash && (
              <span
                className={`chip whitespace-nowrap ${
                  flash.tone === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {flash.text}
              </span>
            )}
          </div>
          {ambiguous && (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-semibold text-amber-800">
              This barcode matches {ambiguous.length} lines on this PO — pick the correct one:
            </p>
            <div className="flex flex-wrap gap-2">
              {ambiguous.map((it) => (
                <button
                  key={it.productId}
                  type="button"
                  onClick={() => resolveAmbiguous(it)}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:bg-amber-100"
                >
                  <span className="font-semibold text-ink-800">{it.name}</span>
                  <span className="ml-1.5 text-slate-400">{it.sku}</span>
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
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-center font-semibold">Ordered</th>
              <th className="px-3 py-2 text-center font-semibold">Prev.</th>
              <th className="px-3 py-2 text-center font-semibold">Add</th>
              <th className="px-3 py-2 text-center font-semibold">Receiving</th>
              {/* Money value of what's being received — check it line-by-line
                  against the supplier invoice before confirming. */}
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.map((it) => {
              const receivingNow = now[it.productId] || 0;
              const afterTotal = it.qtyReceived + receivingNow;
              const short = it.qtyOrdered - afterTotal;
              return (
                <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink-800">{it.name}</p>
                    {it.barcode && <p className="text-[11px] text-slate-400">{it.barcode}</p>}
                    <p className="text-xs">
                      {short > 0 ? (
                        <span className="text-amber-600">short {short}</span>
                      ) : short < 0 ? (
                        <span className="text-rose-500">over {Math.abs(short)}</span>
                      ) : (
                        <span className="text-emerald-600">complete</span>
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">{it.qtyOrdered}</td>
                  <td className="px-3 py-2 text-center text-slate-400">{it.qtyReceived}</td>
                  {/* Type an amount and press Enter — it ADDS to the running
                      total and the box clears itself, ready for the next entry.
                      It never replaces what's already counted: the same item
                      often arrives as several boxes, and each one is its own
                      entry. */}
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      placeholder="+"
                      ref={(el) => {
                        qtyRefs.current[it.productId] = el;
                      }}
                      value={addBox[it.productId] ?? ""}
                      onChange={(e) => setAddBox((p) => ({ ...p, [it.productId]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyAdd(it.productId);
                        }
                      }}
                      // Don't strand a typed number: leaving the box banks it
                      // rather than quietly dropping it.
                      onBlur={() => applyAdd(it.productId, false)}
                      className="mx-auto block w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={`min-w-[2rem] text-center text-[15px] font-bold tabular-nums ${
                          receivingNow > 0 ? "text-ink-900" : "text-slate-300"
                        }`}
                      >
                        {receivingNow}
                      </span>
                      {/* Additive entry has no undo of its own — a mistyped 240
                          would otherwise be stuck. This resets the line to 0 so
                          it can be counted again. */}
                      {receivingNow > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setNow((p) => ({ ...p, [it.productId]: 0 }));
                            setAddBox((p) => ({ ...p, [it.productId]: "" }));
                          }}
                          title="Clear this line and count it again"
                          aria-label={`Clear ${it.name}`}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                  {/* Line amount = unit cost × quantity received. The small unit
                      price underneath is what to reconcile against the invoice. */}
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`block text-sm font-semibold tabular-nums ${
                        receivingNow > 0 ? "text-ink-900" : "text-slate-300"
                      }`}
                    >
                      {usd(it.cost * receivingNow)}
                    </span>
                    <span className="block text-[11px] tabular-nums text-slate-400">{usd(it.cost)} ea</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Grand total of what's being received now — compare it to the
              invoice grand total to confirm the delivery matches the bill. */}
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500" colSpan={4}>
                Receiving total
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">{totalNow}</td>
              <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-ink-900">{usd(totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Supplier invoice — scanned on the PO card; shown here as status. */}
      <div className="mt-4">
        <label className="label flex items-center gap-1.5">
          <FileType2 size={13} /> Supplier invoice <span className="text-rose-500">*</span>
        </label>
        {invoicePages.length ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
            <div className="flex -space-x-3">
              {invoicePages.slice(0, 3).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`Invoice page ${i + 1}`}
                  className="h-16 w-16 rounded-lg object-cover ring-2 ring-white"
                  style={{ zIndex: 3 - i }}
                />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-700">
                Invoice attached ✓ {invoicePages.length > 1 && `· ${invoicePages.length} pages`}
              </p>
              <p className="text-xs text-slate-500">Accounting will review it after you confirm.</p>
            </div>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={onScanInvoice}>
              Re-scan
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onScanInvoice}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 px-4 py-4 text-sm font-semibold text-amber-700 transition hover:border-amber-400"
            >
              <Camera size={17} /> No invoice yet — scan the supplier invoice
            </button>
            <p className="mt-1.5 text-xs text-amber-600">
              You can still confirm the goods now, but the receipt stays <b>incomplete</b> until the invoice is scanned.
            </p>
          </>
        )}
      </div>

        <div className="mt-4">
          <label className="label flex items-center gap-1.5">
            <ShieldCheck size={13} /> Received by
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm">
            <span className="font-semibold text-ink-800">{receivedBy}</span>
            <span className="text-xs text-slate-400">· recorded automatically (signed-in user)</span>
          </div>
        </div>
      </div>

      {/* Review step — a checkable summary of everything being received before
          anything is posted. This is the ONLY place stock is actually committed:
          the main screen's button just opens this. */}
      {reviewing && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[3px]" onClick={() => setReviewing(false)} />
          <div className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden bg-white shadow-lift ring-1 ring-slate-900/[0.08] max-sm:h-full sm:max-h-[85vh] sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-ink-900">Review receipt · {po.poNo}</h3>
              <button
                onClick={() => setReviewing(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <p className="mb-3 text-sm text-slate-500">
                Check this against the supplier invoice — nothing is posted yet. <b>Submit</b> books it into stock.
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 font-semibold">Product</th>
                      <th className="px-3 py-2 text-center font-semibold">Qty</th>
                      <th className="px-3 py-2 text-center font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items
                      .filter((it) => (now[it.productId] || 0) > 0)
                      .map((it) => {
                        const q = now[it.productId] || 0;
                        const short = it.qtyOrdered - (it.qtyReceived + q);
                        return (
                          <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-semibold text-ink-800">{it.name}</p>
                              <p className="text-[11px] text-slate-400">ordered {it.qtyOrdered}</p>
                            </td>
                            <td className="px-3 py-2 text-center text-[15px] font-bold tabular-nums text-ink-900">{q}</td>
                            <td className="px-3 py-2 text-center text-xs">
                              {short > 0 ? (
                                <span className="font-semibold text-amber-600">short {short}</span>
                              ) : short < 0 ? (
                                <span className="font-semibold text-rose-500">over {Math.abs(short)}</span>
                              ) : (
                                <span className="font-semibold text-emerald-600">complete</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-800">{usd(it.cost * q)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Total</td>
                      <td className="px-3 py-2.5 text-center font-bold tabular-nums text-ink-900">{totalNow}</td>
                      <td />
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-ink-900">{usd(totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Lines the PO still owes after this receipt. */}
              {(() => {
                const owed = po.items.filter((it) => it.qtyOrdered - (it.qtyReceived + (now[it.productId] || 0)) > 0);
                if (!owed.length) return null;
                return (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    <b>{owed.length}</b> line{owed.length === 1 ? "" : "s"} still short — not everything ordered has arrived.
                  </p>
                );
              })()}

              {/* Invoice status — decides whether submitting closes the PO. */}
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                  invoicePages.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {invoicePages.length ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <Camera size={14} className="mt-0.5 shrink-0" />}
                <span>
                  {invoicePages.length
                    ? `Invoice attached${invoicePages.length > 1 ? ` · ${invoicePages.length} pages` : ""} — submitting closes this PO (done).`
                    : "No invoice yet — the receipt will be incomplete and the PO stays open until the invoice is scanned."}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-400">Received by {receivedBy} · recorded automatically.</p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
              <button className="btn-ghost" disabled={busy} onClick={() => setReviewing(false)}>
                Back
              </button>
              <button className="btn-primary" disabled={busy} onClick={confirm}>
                <CheckCircle2 size={16} /> {busy ? "Submitting…" : `Submit receipt (+${totalNow})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
