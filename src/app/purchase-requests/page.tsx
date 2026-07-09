"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Send,
  FileSpreadsheet,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ScanLine,
  PackageCheck,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, PurchaseRequest, PRStatus } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { LineBuilder, Line } from "@/components/LineBuilder";
import { usd, num, dateTime } from "@/lib/format";

type Suggestion = {
  productId: string;
  sku: string;
  name: string;
  supplier: string;
  unit: string;
  cost: number;
  stock: number;
  reorderLevel: number;
  suggestedQty: number;
};

const prTotal = (pr: PurchaseRequest) => pr.items.reduce((s, i) => s + i.cost * i.qty, 0);

// Draft → Submitted → Approved → Ordered progress trail (Rejected shown apart)
function StatusTrail({ status }: { status: PRStatus }) {
  if (status === "Rejected") return <Badge tone="rose">Rejected</Badge>;
  const idx = status === "Draft" ? 0 : status === "Submitted" ? 1 : status === "Approved" ? 2 : 3;
  const labels = ["Draft", "Submitted", "Approved", "Ordered"];
  return (
    <div className="flex items-center gap-1.5">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              i < idx ? "bg-brand-400" : i === idx ? "bg-brand-600 ring-4 ring-brand-100" : "bg-slate-200"
            }`}
            title={l}
          />
          {i < labels.length - 1 && <div className={`h-px w-4 ${i < idx ? "bg-brand-300" : "bg-slate-200"}`} />}
        </div>
      ))}
      <span className="ml-2 text-xs font-semibold text-slate-500">{status === "Converted" ? "Ordered" : status}</span>
    </div>
  );
}

export default function PurchaseRequestsPage() {
  const { data: prs, loading, error, reload } = useFetch<PurchaseRequest[]>("/api/purchase-requests");
  const { data: products } = useFetch<Product[]>("/api/products");
  const { data: suggestions } = useFetch<Suggestion[]>("/api/reorder-suggestions");
  const [creating, setCreating] = useState(false);
  const [initialLines, setInitialLines] = useState<Line[]>([]);
  const [viewing, setViewing] = useState<PurchaseRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const list = prs || [];
  const drafts = list.filter((p) => p.status === "Draft").length;
  const pending = list.filter((p) => p.status === "Submitted").length;
  const inProcurement = list.filter((p) => p.status === "Approved" || p.status === "Converted").length;

  const productById = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);

  function startRequest(lines: Line[] = []) {
    setInitialLines(lines);
    setCreating(true);
  }

  function quickAdd(s: Suggestion) {
    const p = productById.get(s.productId);
    if (!p) return;
    startRequest([{ product: p, qty: s.suggestedQty || 1 }]);
  }

  function requestAllLow() {
    const lines: Line[] = [];
    for (const s of suggestions || []) {
      const p = productById.get(s.productId);
      if (p && s.suggestedQty > 0) lines.push({ product: p, qty: s.suggestedQty });
    }
    startRequest(lines);
  }

  async function setStatus(pr: PurchaseRequest, status: PRStatus) {
    setBusy(true);
    try {
      await api(`/api/purchase-requests/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setViewing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(pr: PurchaseRequest) {
    if (!confirm(`Delete ${pr.prNo}?`)) return;
    await api(`/api/purchase-requests/${pr.id}`, { method: "DELETE" });
    reload();
  }

  const lowStock = (suggestions || []).slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Purchase Requests"
        subtitle="Create and track stock requests — approval and ordering are handled by Procurement"
        actions={
          <button className="btn-primary" onClick={() => startRequest()}>
            <Plus size={18} /> New Request
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Draft Requests" value={num(drafts)} icon={<FileText size={18} />} accent="brand" />
        <StatCard label="Awaiting Approval" value={num(pending)} icon={<Clock size={18} />} accent="amber" />
        <StatCard label="With Procurement" value={num(inProcurement)} icon={<CheckCircle2 size={18} />} accent="emerald" />
        <StatCard
          label="Items Below Minimum"
          value={num(suggestions?.length || 0)}
          icon={<AlertTriangle size={18} />}
          accent="rose"
        />
      </div>

      {/* Reorder suggestions */}
      {lowStock.length > 0 && (
        <Card className="mb-6 p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div>
              <h3 className="text-sm font-bold text-ink-900">Reorder Suggestions</h3>
              <p className="text-xs text-slate-500">Items at or below their minimum stock level</p>
            </div>
            <button onClick={requestAllLow} className="btn-ghost !py-1.5 text-xs">
              Add all {num(suggestions!.length)} to request
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4">
            {lowStock.map((s, i) => (
              <button
                key={s.productId}
                onClick={() => quickAdd(s)}
                className={`group flex items-center justify-between gap-2 px-5 py-3.5 text-left transition hover:bg-brand-50/50 ${
                  i % 4 !== 3 ? "lg:border-r lg:border-slate-100" : ""
                } ${i < lowStock.length - (lowStock.length % 4 || 4) ? "border-b border-slate-100" : ""}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-800">{s.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    On hand{" "}
                    <span className={s.stock <= 0 ? "font-semibold text-rose-600" : "font-semibold text-amber-600"}>
                      {s.stock}
                    </span>{" "}
                    · Min {s.reorderLevel} · Suggested {s.suggestedQty}
                  </p>
                </div>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-400 transition group-hover:border-brand-500 group-hover:bg-brand-600 group-hover:text-white">
                  <Plus size={14} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Requests */}
      <Card className="p-0">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-bold text-ink-900">Requests</h3>
        </div>
        {loading ? (
          <Spinner label="Loading requests…" />
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400">
              <FileText size={22} />
            </div>
            <h3 className="mt-4 text-base font-bold text-ink-900">No purchase requests</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Create a request to restock items. The process has three steps:
            </p>
            <div className="mx-auto mt-6 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
              {[
                { icon: ScanLine, title: "Add items", text: "Scan barcodes or select from reorder suggestions" },
                { icon: Send, title: "Submit for approval", text: "The request is routed to Procurement for review" },
                { icon: PackageCheck, title: "Receive goods", text: "Stock levels update automatically on receipt" },
              ].map((s, i) => (
                <div key={s.title} className="rounded-xl border border-slate-200 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <s.icon size={16} className="text-brand-600" />
                    <p className="text-sm font-semibold text-ink-800">
                      {i + 1}. {s.title}
                    </p>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{s.text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => startRequest()} className="btn-primary mt-7">
              <Plus size={18} /> New Request
            </button>
          </div>
        ) : (
          <div>
            {list.map((pr) => (
              <div
                key={pr.id}
                className="flex cursor-pointer flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 transition last:border-0 hover:bg-slate-50/60"
                onClick={() => setViewing(pr)}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {pr.prNo}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {pr.requestedBy} · {dateTime(pr.createdAt)}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {pr.items.length} item{pr.items.length === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-ink-800">{usd(prTotal(pr))}</span>
                    {pr.note ? <span className="text-slate-400"> · {pr.note}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-5" onClick={(e) => e.stopPropagation()}>
                  <StatusTrail status={pr.status} />
                  <div className="flex items-center gap-1">
                    {pr.status === "Draft" && (
                      <button onClick={() => setStatus(pr, "Submitted")} className="btn-primary !px-3 !py-1.5 text-xs">
                        <Send size={13} /> Submit
                      </button>
                    )}
                    {(pr.status === "Draft" || pr.status === "Rejected") && (
                      <button
                        title="Delete"
                        onClick={() => remove(pr)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => setViewing(pr)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {creating && (
        <CreatePRModal
          products={products || []}
          suggestions={suggestions || []}
          initialLines={initialLines}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {viewing && (
        <ViewPRModal
          pr={viewing}
          busy={busy}
          onClose={() => setViewing(null)}
          onSubmit={() => setStatus(viewing, "Submitted")}
        />
      )}
    </div>
  );
}

function CreatePRModal({
  products,
  suggestions,
  initialLines,
  onClose,
  onCreated,
}: {
  products: Product[];
  suggestions: { productId: string; suggestedQty: number }[];
  initialLines: Line[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(submit: boolean) {
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await api("/api/purchase-requests", {
        method: "POST",
        body: JSON.stringify({
          status: submit ? "Submitted" : "Draft",
          note,
          items: lines.map((l) => ({
            productId: l.product.id,
            sku: l.product.sku,
            name: l.product.name,
            supplier: l.product.supplier,
            unit: l.product.unit,
            qty: l.qty,
            cost: l.product.cost,
            barcode: l.product.barcode,
          })),
        }),
      });
      onCreated();
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
      title="New Purchase Request"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-ghost" disabled={busy || lines.length === 0} onClick={() => save(false)}>
            Save as draft
          </button>
          <button className="btn-primary" disabled={busy || lines.length === 0} onClick={() => save(true)}>
            <Send size={16} /> {busy ? "Submitting…" : "Submit for Approval"}
          </button>
        </>
      }
    >
      <LineBuilder products={products} lines={lines} setLines={setLines} suggestions={suggestions} />
      <div className="mt-4">
        <label className="label">Note (optional)</label>
        <input
          className="input"
          placeholder="e.g. Weekend replenishment"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function ViewPRModal({
  pr,
  busy,
  onClose,
  onSubmit,
}: {
  pr: PurchaseRequest;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const total = prTotal(pr);
  return (
    <Modal
      open
      onClose={onClose}
      title={pr.prNo}
      footer={
        <div className="flex w-full items-center justify-between">
          <StatusTrail status={pr.status} />
          <div className="flex gap-2">
            <a href={`/api/purchase-requests/${pr.id}/export`} className="btn-ghost">
              <FileSpreadsheet size={16} /> Export Excel
            </a>
            {pr.status === "Draft" && (
              <button className="btn-primary" disabled={busy} onClick={onSubmit}>
                <Send size={16} /> Submit for Approval
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
        <span>
          Requested by <b className="text-ink-700">{pr.requestedBy}</b>
        </span>
        <span>{dateTime(pr.createdAt)}</span>
        {pr.poIds.length > 0 && (
          <span className="text-brand-600">
            {pr.poIds.length} purchase order{pr.poIds.length === 1 ? "" : "s"} generated
          </span>
        )}
      </div>
      {pr.note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{pr.note}</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 font-semibold">Supplier</th>
              <th className="px-3 py-2 text-center font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pr.items.map((it) => (
              <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2">
                  <p className="font-semibold text-ink-800">{it.name}</p>
                  <p className="text-[11px] text-slate-400">{it.barcode || it.sku}</p>
                </td>
                <td className="px-3 py-2 text-slate-600">{it.supplier}</td>
                <td className="px-3 py-2 text-center">
                  {it.qty} {it.unit}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-ink-800">{usd(it.cost * it.qty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50">
              <td className="px-3 py-2.5 text-xs font-semibold uppercase text-slate-500" colSpan={3}>
                Total estimated cost
              </td>
              <td className="px-3 py-2.5 text-right font-bold text-ink-900">{usd(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}
