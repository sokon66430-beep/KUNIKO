"use client";

import { useMemo, useState } from "react";
import { ReceiptText, CheckCircle2, XCircle, Clock, X, Printer } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { InvoiceReview } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, EmptyState } from "@/components/ui";
import { num, dateTime } from "@/lib/format";

// Accounting — review the supplier invoices scanned at goods receiving.
type Row = {
  grnId: string;
  grnNo: string;
  poNo: string;
  supplier: string;
  receivedBy: string;
  createdAt: string;
  items: number;
  units: number;
  invoice: InvoiceReview;
};

const STATUS_TONE = { Pending: "amber", Approved: "emerald", Rejected: "rose" } as const;

export default function InvoicesPage() {
  const { data: rows, loading, error, reload } = useFetch<Row[]>("/api/invoices");
  const [filter, setFilter] = useState<"All" | "Pending" | "Approved" | "Rejected">("Pending");
  const [viewing, setViewing] = useState<Row | null>(null);

  const list = rows || [];
  const counts = useMemo(
    () => ({
      Pending: list.filter((r) => r.invoice.status === "Pending").length,
      Approved: list.filter((r) => r.invoice.status === "Approved").length,
      Rejected: list.filter((r) => r.invoice.status === "Rejected").length,
    }),
    [list],
  );
  const shown = filter === "All" ? list : list.filter((r) => r.invoice.status === filter);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Accounting — review the supplier invoices scanned at goods receiving"
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting Review" value={num(counts.Pending)} icon={<Clock size={18} />} accent="amber" />
        <StatCard label="Approved" value={num(counts.Approved)} icon={<CheckCircle2 size={18} />} accent="emerald" />
        <StatCard label="Rejected" value={num(counts.Rejected)} icon={<XCircle size={18} />} accent="rose" />
        <StatCard label="Total Invoices" value={num(list.length)} icon={<ReceiptText size={18} />} accent="brand" />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3.5">
          {(["Pending", "Approved", "Rejected", "All"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === f ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {f}
              {f !== "All" ? ` (${counts[f]})` : ""}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid h-40 place-items-center">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title={filter === "Pending" ? "No invoices waiting" : "No invoices here"}
              hint="Invoices are added automatically when goods are received — the receiver must scan the supplier's invoice."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {shown.map((r) => (
              <li key={r.grnId}>
                <button
                  onClick={() => setViewing(r)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/invoice-image/${r.invoice.image}`}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-800">
                      {r.grnNo} <span className="font-normal text-slate-400">· {r.poNo}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {r.supplier} · {num(r.units)} units · received by {r.receivedBy} · {dateTime(r.createdAt)}
                    </p>
                    {r.invoice.status !== "Pending" && (
                      <p className="text-[11px] text-slate-400">
                        {r.invoice.status} by {r.invoice.reviewedBy}
                        {r.invoice.reviewNote ? ` — “${r.invoice.reviewNote}”` : ""}
                      </p>
                    )}
                  </div>
                  <Badge tone={STATUS_TONE[r.invoice.status]}>{r.invoice.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {viewing && (
        <ReviewModal
          row={viewing}
          onClose={() => setViewing(null)}
          onDone={() => {
            setViewing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(row.invoice.reviewNote || "");
  const [busy, setBusy] = useState(false);

  // Print just the invoice image on its own page.
  function printInvoice() {
    const url = `/api/invoice-image/${row.invoice.image}`;
    const w = window.open("", "PRINT", "width=820,height=1040");
    if (!w) {
      window.print();
      return;
    }
    w.document.write(
      `<!doctype html><html><head><title>Invoice ${row.grnNo} — ${row.poNo}</title>` +
        `<style>@page{margin:10mm}body{margin:0;font-family:system-ui,sans-serif}` +
        `.h{font-size:12px;color:#555;padding:6px 2px}img{width:100%;height:auto;display:block}</style></head>` +
        `<body><div class="h">${row.grnNo} · ${row.poNo} · ${row.supplier}</div>` +
        `<img src="${url}" onload="window.focus();window.print();"></body></html>`,
    );
    w.document.close();
  }

  async function decide(status: "Approved" | "Rejected") {
    setBusy(true);
    try {
      await api(`/api/invoices/${row.grnId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      });
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
          <div>
            <h3 className="text-base font-bold text-ink-900">
              Invoice · {row.grnNo} <span className="font-normal text-slate-400">({row.poNo})</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {row.supplier} · received by {row.receivedBy} · {dateTime(row.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/invoice-image/${row.invoice.image}`}
            alt={`Invoice for ${row.grnNo}`}
            className="mx-auto max-w-full rounded-xl shadow-soft"
          />
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <input
            className="input mb-3 text-sm"
            placeholder="Note (optional) — e.g. why it's rejected"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="btn-ghost mr-auto" onClick={printInvoice}>
              <Printer size={16} /> Print
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => decide("Rejected")}>
              <XCircle size={16} /> Reject
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => decide("Approved")}>
              <CheckCircle2 size={16} /> {busy ? "Saving…" : "Approve"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
