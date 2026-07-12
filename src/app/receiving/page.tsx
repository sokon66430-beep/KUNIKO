"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PackageCheck,
  Truck,
  ScanLine,
  History,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Camera,
  FileSpreadsheet,
  FileType2,
  Pencil,
  Clock,
  ShieldCheck,
  Printer,
  X,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import { InvoiceCamera } from "@/components/InvoiceCamera";
import type { PurchaseOrder, GoodsReceipt } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { num, dateTime, shortDate } from "@/lib/format";

export default function ReceivingPage() {
  const { data: pos, loading, error, reload } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const { data: grns, reload: reloadGrns } = useFetch<GoodsReceipt[]>("/api/goods-receipts");
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [editing, setEditing] = useState<GoodsReceipt | null>(null);
  const [reviewing, setReviewing] = useState<GoodsReceipt | null>(null);
  const [pdfView, setPdfView] = useState<{ url: string; title: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  // Supplier invoices scanned on each PO card (held here until the receipt is
  // confirmed, then sent with it). Keyed by PO id.
  const [invoiceByPo, setInvoiceByPo] = useState<Record<string, string>>({});
  const [invoiceCamPo, setInvoiceCamPo] = useState<string | null>(null);

  // Open a receipt's PDF inside the app (so it can be viewed and printed here).
  async function openPdf(g: GoodsReceipt) {
    setPdfLoading(g.id);
    try {
      const res = await fetch(`/api/goods-receipts/${g.id}/export?format=pdf`);
      const blob = await res.blob();
      setPdfView({ url: URL.createObjectURL(blob), title: g.grnNo });
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

  const openPOs = (pos || []).filter((p) => p.status === "Open" || p.status === "Partial");
  const receiptsToday = (grns || []).length;
  const pendingApprovals = (grns || []).filter((g) => g.status === "PendingApproval").length;

  return (
    <div>
      <PageHeader
        title="Goods Receiving"
        subtitle="Scan supplier deliveries against a PO — stock updates on every scan"
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting Delivery" value={num(openPOs.length)} icon={<Truck size={18} />} accent="amber" />
        <StatCard
          label="Partially Received"
          value={num((pos || []).filter((p) => p.status === "Partial").length)}
          icon={<AlertTriangle size={18} />}
          accent="rose"
        />
        <StatCard label="Receipts Logged" value={num(receiptsToday)} icon={<PackageCheck size={18} />} accent="emerald" />
        <StatCard
          label="Units Ordered"
          value={num(openPOs.reduce((s, p) => s + p.items.reduce((t, i) => t + i.qtyOrdered, 0), 0))}
          icon={<ClipboardList size={18} />}
          accent="brand"
        />
      </div>

      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <Truck size={16} /> Open Purchase Orders
      </h2>

      {loading ? (
        <Card>
          <Spinner label="Loading deliveries…" />
        </Card>
      ) : openPOs.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to receive" hint="All purchase orders are fully received." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {openPOs.map((po) => {
            const ordered = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
            const received = po.items.reduce((s, i) => s + Math.min(i.qtyReceived, i.qtyOrdered), 0);
            const pct = ordered ? Math.round((received / ordered) * 100) : 0;
            const hasInvoice = !!invoiceByPo[po.id];
            return (
              <div key={po.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-ink-900">{po.poNo}</p>
                    <p className="text-xs text-slate-400">{po.supplier}</p>
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
                <p className="mt-3 text-xs text-slate-400">
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
                    disabled={!hasInvoice}
                    title={hasInvoice ? undefined : "Scan the supplier invoice first"}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-40"
                  >
                    <ScanLine size={14} /> Receive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Receiving history */}
      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <History size={16} /> Recent Receipts
        </h2>
        {(grns || []).length > 0 && (
          <a href="/api/reports/goods-receipts/export" className="btn-ghost !py-1.5 text-xs">
            <FileSpreadsheet size={15} /> Export Excel
          </a>
        )}
      </div>
      {pendingApprovals > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Clock size={16} className="shrink-0" />
          <span>
            <b>{pendingApprovals}</b> receipt edit{pendingApprovals === 1 ? "" : "s"} waiting for a manager to approve —
            stock hasn&apos;t changed yet.
          </span>
        </div>
      )}
      <Card className="p-0">
        {(grns || []).length === 0 ? (
          <EmptyState title="No receipts yet" hint="Received goods will be logged here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 font-semibold">PO / Supplier</th>
                  <th className="px-4 py-3 text-center font-semibold">Items</th>
                  <th className="px-4 py-3 text-center font-semibold">Units</th>
                  <th className="px-4 py-3 font-semibold">Received by</th>
                  <th className="px-4 py-3 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {(grns || []).map((g) => {
                  const pending = g.status === "PendingApproval";
                  return (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-800">{g.grnNo}</p>
                        <p className="text-xs text-slate-400">{dateTime(g.createdAt)}</p>
                        {pending && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            <Clock size={11} /> Edit pending approval
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{g.poNo}</p>
                        <p className="text-xs text-slate-400">{g.supplier}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{g.items.length}</td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-600">
                        +{g.items.reduce((s, i) => s + i.qtyReceived, 0)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{g.receivedBy}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/goods-receipts/${g.id}/export`}
                            title="Download this receipt as Excel"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50"
                          >
                            <FileSpreadsheet size={14} /> Excel
                          </a>
                          <button
                            onClick={() => openPdf(g)}
                            disabled={pdfLoading === g.id}
                            title="View this receipt as PDF (with print)"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <FileType2 size={14} /> {pdfLoading === g.id ? "Opening…" : "PDF"}
                          </button>
                          {pending ? (
                            <button
                              onClick={() => setReviewing(g)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                            >
                              <ShieldCheck size={14} /> Review &amp; approve
                            </button>
                          ) : (
                            <button
                              onClick={() => setEditing(g)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <Pencil size={14} /> Edit
                            </button>
                          )}
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

      {/* Invoice camera opened from a PO card — holds the photo for that PO. */}
      <InvoiceCamera
        open={!!invoiceCamPo}
        onClose={() => setInvoiceCamPo(null)}
        onCapture={(d) => setInvoiceByPo((prev) => ({ ...prev, [invoiceCamPo!]: d }))}
      />

      {receiving && (
        <ReceiveModal
          po={receiving}
          invoice={invoiceByPo[receiving.id] || ""}
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
            reloadGrns();
          }}
        />
      )}

      {editing && (
        <EditReceiptModal
          grn={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reloadGrns();
          }}
        />
      )}

      {reviewing && (
        <ApproveModal
          grn={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            reload();
            reloadGrns();
          }}
        />
      )}

      {pdfView && <PdfViewer url={pdfView.url} title={pdfView.title} onClose={closePdf} />}
    </div>
  );
}

// In-app PDF viewer with Print + Download. Used to preview a goods receipt.
function PdfViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  function print() {
    const w = frameRef.current?.contentWindow;
    if (w) {
      w.focus();
      w.print();
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-ink-900">Receipt {title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={print} className="btn-primary !py-2 text-sm">
              <Printer size={15} /> Print
            </button>
            <a href={url} download={`${title}.pdf`} className="btn-ghost !py-2 text-sm">
              <FileType2 size={15} /> Download
            </a>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <iframe ref={frameRef} src={url} title={`Receipt ${title}`} className="w-full flex-1" />
      </div>
    </div>
  );
}

// Request a correction to a submitted receipt. Stock does NOT change here — it
// waits for a manager to approve.
function EditReceiptModal({
  grn,
  onClose,
  onDone,
}: {
  grn: GoodsReceipt;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(grn.items.map((i) => [i.productId, i.qtyReceived])),
  );
  // The person requesting the correction is always the signed-in user.
  const { data: session } = useFetch<{ user?: { name?: string } }>("/api/auth/session");
  const requestedBy = session?.user?.name || "—";
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const changed = grn.items.some((i) => (Number(qty[i.productId]) || 0) !== i.qtyReceived);

  async function submit() {
    const items = grn.items.map((i) => ({
      productId: i.productId,
      qtyReceived: Math.max(0, Number(qty[i.productId]) || 0),
    }));
    setBusy(true);
    try {
      await api(`/api/goods-receipts/${grn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ items, requestedBy, note }),
      });
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit receipt · ${grn.grnNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !changed} onClick={submit}>
            <ShieldCheck size={16} /> {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <Clock size={15} className="mt-0.5 shrink-0" />
        <span>Corrections don&apos;t change stock right away — a Manager or Assistant Manager must approve first.</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-center font-semibold">Received</th>
              <th className="px-3 py-2 text-center font-semibold">Correct to</th>
            </tr>
          </thead>
          <tbody>
            {grn.items.map((it) => {
              const v = Number(qty[it.productId]) || 0;
              const diff = v - it.qtyReceived;
              return (
                <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink-800">{it.name}</p>
                    <p className="text-xs text-slate-400">{it.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-400">{it.qtyReceived}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={v}
                        onChange={(e) =>
                          setQty((p) => ({ ...p, [it.productId]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      />
                      {diff !== 0 && (
                        <span className={`text-xs font-semibold ${diff > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label flex items-center gap-1.5">
            <ShieldCheck size={13} /> Requested by
          </label>
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-ink-800">
            {requestedBy}
          </div>
        </div>
        <div>
          <label className="label">Reason (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. miscount on delivery" />
        </div>
      </div>
    </Modal>
  );
}

// Manager review: shows the requested change and applies it once a valid
// approval code is entered/scanned.
function ApproveModal({
  grn,
  onClose,
  onDone,
}: {
  grn: GoodsReceipt;
  onClose: () => void;
  onDone: () => void;
}) {
  const pe = grn.pendingEdit;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState("");

  const rows = grn.items.map((li) => {
    const req = pe?.items.find((x) => x.productId === li.productId);
    return { name: li.name, sku: li.sku, from: li.qtyReceived, to: req ? req.qtyReceived : li.qtyReceived };
  });

  async function decide(decision: "approve" | "reject") {
    if (!code.trim()) {
      setErr("Enter or scan your approval code");
      return;
    }
    setBusy(decision);
    setErr("");
    try {
      await api(`/api/goods-receipts/${grn.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ code, decision }),
      });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve edit · ${grn.grnNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            disabled={busy !== null}
            onClick={() => decide("reject")}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button className="btn-primary" disabled={busy !== null} onClick={() => decide("approve")}>
            <ShieldCheck size={16} /> {busy === "approve" ? "Approving…" : "Approve"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Requested by <b className="text-ink-700">{pe?.requestedBy || "—"}</b>
        {pe?.note ? <> · “{pe.note}”</> : null}. Approving updates stock to the new quantities.
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-center font-semibold">Now</th>
              <th className="px-3 py-2 text-center font-semibold">Requested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.to - r.from;
              return (
                <tr key={r.sku} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink-800">{r.name}</p>
                    <p className="text-xs text-slate-400">{r.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-400">{r.from}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-500" : "text-slate-600"}`}>
                      {r.to}
                      {diff !== 0 && <span className="ml-1 text-xs">({diff > 0 ? `+${diff}` : diff})</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <label className="label flex items-center gap-1.5">
          <ShieldCheck size={13} /> Manager approval code
        </label>
        <input
          className="input tracking-widest"
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              decide("approve");
            }
          }}
          placeholder="Scan badge or type code"
        />
        <p className="mt-1 text-xs text-slate-400">
          Only a Manager or Assistant Manager code can approve. Set these in Store Settings.
        </p>
        {err && <p className="mt-2 text-sm font-medium text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}

function ReceiveModal({
  po,
  invoice,
  onScanInvoice,
  onClose,
  onDone,
}: {
  po: PurchaseOrder;
  invoice: string; // supplier invoice scanned on the PO card (required)
  onScanInvoice: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  // qty being received in THIS session, keyed by productId. Default to remaining.
  const initial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of po.items) m[it.productId] = Math.max(it.qtyOrdered - it.qtyReceived, 0);
    return m;
  }, [po]);
  const [now, setNow] = useState<Record<string, number>>(initial);
  const [scan, setScan] = useState("");
  // "Received by" is always the signed-in user — recorded automatically, not editable.
  const { data: session } = useFetch<{ user?: { name?: string } }>("/api/auth/session");
  const receivedBy = session?.user?.name || "—";
  const [flash, setFlash] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<typeof po.items | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  function bump(productId: string, name: string) {
    setNow((p) => ({ ...p, [productId]: (p[productId] || 0) + 1 }));
    seq.current += 1;
    const s = seq.current;
    setScanOrder((o) => ({ ...o, [productId]: s }));
    setFlash({ tone: "ok", text: `+1 ${name}` });
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
    const byBarcode = po.items.filter((i) => i.barcode === code);
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
    if (!invoice) {
      setFlash({ tone: "warn", text: "Scan the supplier's invoice on the PO card first — it's required" });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ items, receivedBy, invoice }),
      });
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const totalNow = Object.values(now).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive · ${po.poNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || totalNow === 0 || !invoice}
            title={!invoice ? "Scan the supplier's invoice first" : undefined}
            onClick={confirm}
          >
            <CheckCircle2 size={16} /> {busy ? "Posting…" : `Confirm receipt (+${totalNow})`}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Supplier <b className="text-ink-700">{po.supplier}</b> · scan each item or adjust the quantities below.
        Stock updates immediately on confirm.
      </p>

      {/* Scan box */}
      <div className="mb-4">
        <label className="label flex items-center gap-1.5">
          <ScanLine size={13} /> Scan received item (barcode or Item ID)
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
            <input
              ref={scanRef}
              className="input pl-10 pr-12"
              placeholder="Scan, type Item ID, or tap the camera"
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
              <th className="px-3 py-2 text-center font-semibold">Receiving</th>
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
                    <p className="text-xs text-slate-400">
                      {it.sku}
                      {short > 0 ? (
                        <span className="ml-2 text-amber-600">short {short}</span>
                      ) : short < 0 ? (
                        <span className="ml-2 text-rose-500">over {Math.abs(short)}</span>
                      ) : (
                        <span className="ml-2 text-emerald-600">complete</span>
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">{it.qtyOrdered}</td>
                  <td className="px-3 py-2 text-center text-slate-400">{it.qtyReceived}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      ref={(el) => {
                        qtyRefs.current[it.productId] = el;
                      }}
                      value={receivingNow}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        setNow((p) => ({ ...p, [it.productId]: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      onKeyDown={(e) => {
                        // Enter confirms this amount and returns to the scan box for the next item.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          scanRef.current?.focus();
                        }
                      }}
                      className="mx-auto block w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Supplier invoice — scanned on the PO card; shown here as status. */}
      <div className="mt-4">
        <label className="label flex items-center gap-1.5">
          <FileType2 size={13} /> Supplier invoice <span className="text-rose-500">*</span>
        </label>
        {invoice ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={invoice} alt="Invoice" className="h-16 w-16 rounded-lg object-cover ring-1 ring-emerald-200" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-700">Invoice attached ✓</p>
              <p className="text-xs text-slate-500">Accounting will review it after you confirm.</p>
            </div>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={onScanInvoice}>
              Retake
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onScanInvoice}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 px-4 py-4 text-sm font-semibold text-amber-700 transition hover:border-amber-400"
          >
            <Camera size={17} /> No invoice yet — scan the supplier invoice (required)
          </button>
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

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => handleScan(code)} />
    </Modal>
  );
}
