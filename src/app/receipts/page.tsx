"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  History,
  PackageCheck,
  Clock,
  Camera,
  FileSpreadsheet,
  FileType2,
  Pencil,
  ShieldCheck,
  Truck,
  ArrowRight,
  Image as ImageIcon,
  Search,
  Tag,
  X,
} from "lucide-react";
import { useFetch, api, useAccess } from "@/lib/client";
import { InvoiceCamera } from "@/components/InvoiceCamera";
import { PdfViewer } from "@/components/PdfViewer";
import { DatePicker } from "@/components/DatePicker";
import type { GoodsReceipt } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, EmptyState, Modal } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { num, dateTime, usd } from "@/lib/format";
import { canAcceptCosts } from "@/lib/access";

/**
 * Receipt history — split out of /receiving.
 *
 * The two jobs shared one page and one scroll: a store with many open POs had
 * to scroll past every one of them to reach the receipts. Worse, the single
 * page fetched BOTH lists, so opening an old receipt meant downloading every
 * purchase order first. Each page now loads only what it shows.
 */
export default function ReceiptsPage() {
  const { data: grns, loading, error, reload: reloadGrns } = useFetch<GoodsReceipt[]>("/api/goods-receipts");
  const [editing, setEditing] = useState<GoodsReceipt | null>(null);
  const [reviewing, setReviewing] = useState<GoodsReceipt | null>(null);
  /** The receipt whose corrected costs are being accepted into Master Data. */
  const [applying, setApplying] = useState<GoodsReceipt | null>(null);
  /** Who is signed in, and what the owner has granted them on /permissions. */
  const { role, caps } = useAccess();
  const [pdfView, setPdfView] = useState<{ url: string; title: string } | null>(null);
  /** The receipt whose submitted invoice photo is being looked at. */
  const [invoiceView, setInvoiceView] = useState<{ grn: GoodsReceipt } | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date-desc" | "date-asc" | "grn">("date-desc");
  // Filter the receipt history to a date range (inclusive) so the team can track
  // and adjust stock for a period. Empty = all dates.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invoiceCamGrn, setInvoiceCamGrn] = useState<string | null>(null);
  // Free-text search across a receipt's number, its PO, the supplier and who
  // received it — the list grows quickly, so this is the fast way to a receipt.
  const [q, setQ] = useState("");

  const sortedGrns = useMemo(() => {
    const query = q.trim().toLowerCase();
    const l = (grns || []).filter((g) => {
      const day = (g.createdAt || "").slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (
        query &&
        !`${g.grnNo} ${g.poNo} ${g.supplier} ${g.receivedBy}`.toLowerCase().includes(query)
      )
        return false;
      return true;
    });
    if (sortBy === "date-asc") return l.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    if (sortBy === "grn") return l.sort((a, b) => a.grnNo.localeCompare(b.grnNo));
    return l.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [grns, sortBy, from, to, q]);

  // Query string for the export links so Excel/PDF match the on-screen range.
  const rangeQs = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
  const setToday = () => {
    const now = new Date();
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setFrom(d);
    setTo(d);
  };

  const all = grns || [];
  const pendingApprovals = all.filter((g) => g.status === "PendingApproval").length;
  // A receipt with no invoice (or a rejected one) is incomplete — the goods are
  // in, but the paperwork backing them isn't.
  const incomplete = all.filter((g) => !g.invoice || g.invoice.status === "Rejected").length;
  const unitsReceived = all.reduce((s, g) => s + g.items.reduce((t, i) => t + i.qtyReceived, 0), 0);

  async function attachInvoiceToGrn(grnId: string, pages: string[]) {
    try {
      await api(`/api/goods-receipts/${grnId}/invoice`, {
        method: "POST",
        body: JSON.stringify({ invoices: pages }),
      });
      reloadGrns();
    } catch (e: any) {
      alert(e.message);
    }
  }

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

  // The status badges and the action buttons are shared by the desktop table and
  // the phone cards below, so both always show the same thing.
  const statusBadges = (g: GoodsReceipt) => {
    const pending = g.status === "PendingApproval";
    /*
     * COSTS THE RECEIVING TEAM CORRECTED, surfaced on the list itself.
     *
     * The owner asked to be able to check these. A badge only where the
     * receipt is opened would mean opening every receipt to find the two that
     * need a look — so it belongs beside the invoice status, in the one place
     * every receipt is already scanned down.
     *
     * Blue, not amber or rose: a corrected cost is the system working as
     * intended, not a fault. Amber here would train the eye to ignore it.
     */
    const corrected = g.items.filter((i) => i.costWas !== undefined).length;
    return (
      <>
        {corrected > 0 &&
          (g.costsAppliedAt ? (
            /* Accepted: the catalogue now agrees with this receipt. Green and
               past tense, so a row that still needs a decision cannot be
               mistaken for one that has had it — which is the only thing the
               owner is scanning this column for. */
            <span
              className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
              title={`${corrected} corrected cost${corrected === 1 ? "" : "s"} accepted into Master Data by ${g.costsAppliedBy || "—"}`}
            >
              <Tag size={11} /> {corrected} cost{corrected === 1 ? "" : "s"} accepted
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
              title="Receiving keyed a cost that differs from Master Data. Open the receipt to see both figures, or Accept costs to update the catalogue."
            >
              <Tag size={11} /> {corrected} cost{corrected === 1 ? "" : "s"} corrected
            </span>
          ))}
        {pending && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            <Clock size={11} /> Edit pending approval
          </span>
        )}
        {!g.invoice ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
            <FileType2 size={11} /> Incomplete — invoice missing
          </span>
        ) : g.invoice.status === "Rejected" ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
            <FileType2 size={11} /> Invoice rejected — re-scan
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
              g.invoice.status === "Approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            <FileType2 size={11} /> Invoice {g.invoice.status === "Approved" ? "approved" : "pending review"}
          </span>
        )}
      </>
    );
  };

  // variant "row" = the desktop table, where each action gets a FIXED-WIDTH,
  // right-aligned slot so Excel / PDF / the edit-state button line up in clean
  // vertical columns even when some rows have a "Scan invoice" button and some
  // don't. variant "card" = the phone cards, where the buttons simply wrap.
  const rowActions = (g: GoodsReceipt, variant: "row" | "card" = "card") => {
    const pending = g.status === "PendingApproval";
    const needsInvoice = !g.invoice || g.invoice.status === "Rejected";
    /*
     * ACCEPT THE CORRECTED COSTS INTO MASTER DATA.
     *
     * Shown only where there is something to accept and it has not been
     * accepted yet — a permanently-visible button on every receipt would be a
     * control that does nothing on nearly all of them.
     *
     * Sky, matching the badge that brought the owner here, so the two read as
     * one thing: the row says costs were corrected, and this is what to do
     * about it.
     */
    const hasUnapplied = !g.costsAppliedAt && g.items.some((i) => i.costWas !== undefined);
    // Gated on the SAME capability that opens Master Data. Somebody who can
    // already change a cost there directly should not be stopped from
    // accepting the one an invoice proves; somebody who cannot should not see
    // a button that will only refuse them.
    const applyBtn = hasUnapplied && canAcceptCosts(role ?? "store_crew", caps) ? (
      <button
        onClick={() => setApplying(g)}
        title="Update the catalogue to the costs receiving keyed off the invoice"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
      >
        <Tag size={14} /> Accept costs
      </button>
    ) : null;

    // A quiet icon-link like Excel / PDF — not a loud filled button — so the
    // whole actions row reads as one consistent set. The red "Incomplete —
    // invoice missing" status badge is what draws the eye to act.
    const scanBtn = needsInvoice ? (
      <button
        onClick={() => setInvoiceCamGrn(g.id)}
        title="Scan the supplier invoice to complete this receipt"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
      >
        <Camera size={14} /> Scan invoice
      </button>
    ) : null;
    /*
     * SEE THE INVOICE YOU SENT TO ACCOUNTING.
     *
     * There was no way to. The photo went up, the badge changed to "pending
     * review", and the picture itself was reachable only from Accounting's own
     * screen — so the person who scanned it could not check whether the page
     * they shot was straight, legible, or even the right invoice, and a
     * rejection sent them back to a supplier's paperwork with nothing to
     * compare against.
     *
     * The image route already allows any signed-in user and already validates
     * the filename; only the link was missing.
     */
    // Icon only. The actions row already carries four labelled controls, and a
    // fifth word pushed the whole set wide enough to clip on a laptop. The
    // tooltip carries the meaning, and the status badge beside it already says
    // an invoice exists — this is the way to look at it, not the news that it
    // is there.
    const viewInvoiceBtn = g.invoice ? (
      <button
        onClick={() => setInvoiceView({ grn: g })}
        title="See the invoice photo submitted to Accounting"
        aria-label={`See the invoice submitted for ${g.grnNo}`}
        className="inline-flex items-center justify-center rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"
      >
        <ImageIcon size={15} />
      </button>
    ) : null;
    const excelBtn = (
      <a
        href={`/api/goods-receipts/${g.id}/export`}
        title="Download this receipt as Excel"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50"
      >
        <FileSpreadsheet size={14} /> Excel
      </a>
    );
    const pdfBtn = (
      <button
        onClick={() => openPdf(g)}
        disabled={pdfLoading === g.id}
        title="View this receipt as PDF (with print)"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
      >
        <FileType2 size={14} /> {pdfLoading === g.id ? "Opening…" : "PDF"}
      </button>
    );
    const stateBtn = pending ? (
      <button
        onClick={() => setReviewing(g)}
        className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
      >
        <ShieldCheck size={14} /> Review
      </button>
    ) : (
      // EDITABLE AT ANY AGE. The greyed-out "Locked" that used to sit here past
      // two days is gone: an edit does not change stock, it asks a manager to
      // approve one, so age was never what made a correction safe. A supplier
      // query three days after a delivery is the ordinary case, not the
      // suspicious one.
      <button
        onClick={() => setEditing(g)}
        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Pencil size={14} /> Edit
      </button>
    );

    if (variant === "row") {
      // Fixed-width slots, each right-aligned → the buttons form neat columns.
      return (
        <div className="flex items-center justify-end gap-1">
          {/* Scan and View get their OWN slots rather than sharing one. They
              are not mutually exclusive: a REJECTED invoice needs both — see
              what Accounting turned down and why, then shoot it again — and
              that is precisely the moment the picture matters most. */}
          {/* Its own slot, same rule as the rest: the column keeps its width
              whether or not this receipt has costs to accept, so the buttons
              beside it do not shuffle sideways row to row. */}
          <div className="flex w-[104px] justify-end">{applyBtn}</div>
          <div className="flex w-[108px] justify-end">{scanBtn}</div>
          <div className="flex w-[34px] justify-end">{viewInvoiceBtn}</div>
          <div className="flex w-[72px] justify-end">{excelBtn}</div>
          <div className="flex w-[62px] justify-end">{pdfBtn}</div>
          <div className="flex w-[92px] justify-end">{stateBtn}</div>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {applyBtn}
        {scanBtn}
        {viewInvoiceBtn}
        {excelBtn}
        {pdfBtn}
        {stateBtn}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Receipt History"
        subtitle="Every delivery logged — with its invoice, its paperwork and what it put on the shelf"
        actions={
          <Link href="/receiving" className="btn-ghost">
            <Truck size={16} /> Receive a delivery <ArrowRight size={15} />
          </Link>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Receipts Logged" value={num(all.length)} icon={<PackageCheck size={18} />} accent="emerald" />
        <StatCard label="Units Received" value={num(unitsReceived)} icon={<History size={18} />} accent="brand" />
        <StatCard
          label="Awaiting Approval"
          value={num(pendingApprovals)}
          sub={pendingApprovals ? "stock unchanged until approved" : undefined}
          icon={<ShieldCheck size={18} />}
          accent="amber"
        />
        <StatCard
          label="Invoice Missing"
          value={num(incomplete)}
          sub={incomplete ? "goods in, paperwork not" : undefined}
          icon={<FileType2 size={18} />}
          accent={incomplete ? "rose" : "emerald"}
        />
      </div>

      {/* Heading row — the section title on the left, the export actions on the
          right (they act on the whole list, so they belong with the title). */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <History size={16} /> Recent Receipts
          {all.length > 0 && <span className="font-semibold normal-case text-slate-400">({num(sortedGrns.length)})</span>}
        </h2>
        {all.length > 0 && (
          <div className="flex items-center gap-2">
            <a
              href={`/api/reports/goods-receipts/export${rangeQs ? `?${rangeQs}` : ""}`}
              className="btn-ghost !py-1.5 text-xs"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </a>
            <a
              href={`/api/reports/goods-receipts/export?format=pdf${rangeQs ? `&${rangeQs}` : ""}`}
              className="btn-ghost !py-1.5 text-xs"
            >
              <FileType2 size={15} /> PDF
            </a>
          </div>
        )}
      </div>

      {/* Search — find a receipt by its number, PO, supplier or receiver. */}
      {all.length > 0 && (
        <div className="relative mb-3 w-full sm:w-[26rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="input pl-9 !py-2 text-sm"
            placeholder="Search receipt no, PO, supplier or receiver…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputMode="search"
            autoComplete="off"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Filter bar — its own tidy row, with the date range and the sort each in
          a clearly labelled group instead of one long cramped line. */}
      {all.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Date range</span>
            <DatePicker value={from} max={to || undefined} onChange={setFrom} />
            <span className="text-slate-400">→</span>
            <DatePicker value={to} min={from || undefined} onChange={setTo} />
            <button
              type="button"
              onClick={setToday}
              className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-200"
            >
              Today
            </button>
            {(from || to) && (
              <button
                type="button"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className="rounded-lg px-2 py-1 text-slate-400 hover:text-rose-500"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sort by</span>
            <SearchSelect
              className="w-44"
              value={sortBy}
              onChange={(v) => setSortBy(v as any)}
              options={[
                { value: "date-desc", label: "Date · newest first" },
                { value: "date-asc", label: "Date · oldest first" },
                { value: "grn", label: "Receipt number" },
              ]}
            />
          </div>
        </div>
      )}

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
        {loading ? (
          <Spinner label="Loading receipts…" />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<PackageCheck size={19} />}
            title="No receipts yet"
            hint="Receive a delivery against a purchase order and it's logged here, with its invoice and everything it put on the shelf."
            action={
              <Link href="/receiving" className="btn-primary">
                <Truck size={16} /> Receive a delivery
              </Link>
            }
          />
        ) : sortedGrns.length === 0 ? (
          <EmptyState
            title="No matching receipts"
            hint={q.trim() ? `Nothing matches “${q.trim()}”. Try a different search, or clear it.` : "Adjust the From / To dates or Clear the filter."}
          />
        ) : (
          <>
            {/* Desktop: a dense table. Hidden on phones, where six columns plus
                a row of action buttons can't fit and got cut off. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Receipt</th>
                    <th className="px-4 py-3 font-semibold">PO / Supplier</th>
                    <th className="px-4 py-3 text-center font-semibold">Items</th>
                    <th className="px-4 py-3 text-center font-semibold">Units</th>
                    <th className="px-4 py-3 font-semibold">Received by</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGrns.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-800">{g.grnNo}</p>
                        <p className="text-xs text-slate-400">{dateTime(g.createdAt)}</p>
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
                      {/* Status now has its OWN aligned column instead of being
                          tucked under the receipt number. */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">{statusBadges(g)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">{rowActions(g, "row")}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: one card per receipt so the number, supplier, units and
                every action stay on-screen without sideways scrolling. */}
            <div className="divide-y divide-slate-100 sm:hidden">
              {sortedGrns.map((g) => (
                <div key={g.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800">{g.grnNo}</p>
                      <p className="text-xs text-slate-400">{dateTime(g.createdAt)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-emerald-600">
                      +{g.items.reduce((s, i) => s + i.qtyReceived, 0)} units
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{statusBadges(g)}</div>
                  <p className="mt-2 text-sm font-medium text-slate-700">{g.poNo}</p>
                  <p className="text-xs text-slate-400">{g.supplier}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {g.items.length} item{g.items.length === 1 ? "" : "s"} · Received by {g.receivedBy}
                  </p>
                  <div className="mt-3 border-t border-slate-100 pt-3">{rowActions(g)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Invoice camera opened from a receipt row — completes an incomplete receipt. */}
      <InvoiceCamera
        open={!!invoiceCamGrn}
        onClose={() => setInvoiceCamGrn(null)}
        onCapture={(pages) => attachInvoiceToGrn(invoiceCamGrn!, pages)}
      />

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
            reloadGrns();
          }}
        />
      )}

      {applying && (
        <AcceptCostsModal
          grn={applying}
          onClose={() => setApplying(null)}
          onDone={() => {
            setApplying(null);
            reloadGrns();
          }}
        />
      )}

      {pdfView && (
        <PdfViewer url={pdfView.url} title={pdfView.title} heading={`Receipt ${pdfView.title}`} onClose={closePdf} />
      )}
      {invoiceView && (
        <InvoiceViewer grn={invoiceView.grn} onClose={() => setInvoiceView(null)} />
      )}
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

  // The ORDER, not just the receipt.
  //
  // A line delivered as zero was never written to the receipt, so correcting it
  // was impossible — the one case the screen is most needed for. Every ordered
  // product is listed, with what the receipt currently says beside it.
  // The endpoint wraps the order alongside the business header it prints with,
  // so the lines live at `.po.items`, not at the top level.
  const { data: poDoc } = useFetch<{
    po?: { items: { productId: string; name: string; sku: string; qtyOrdered: number }[] };
  }>(`/api/purchase-orders/${grn.poId}`);
  const poItems = poDoc?.po?.items;

  const lines = useMemo(() => {
    const received = new Map(grn.items.map((i) => [i.productId, i]));
    const rows = (poItems || []).map((p) => {
      const got = received.get(p.productId);
      return {
        productId: p.productId,
        name: got?.name || p.name,
        sku: got?.sku || p.sku,
        qtyOrdered: p.qtyOrdered,
        qtyReceived: got?.qtyReceived ?? 0,
        onReceipt: !!got,
        // Carried through so the correction can be READ where the receipt is
        // examined. The badge on the list says a receipt has some; this is
        // where the owner sees which product and both figures.
        cost: got?.cost,
        costWas: got?.costWas,
      };
    });
    // Anything on the receipt but not on the order (the order was edited after
    // delivery, say) still has to be correctable — never drop a line that is
    // already holding stock.
    for (const i of grn.items) {
      if (!rows.some((r) => r.productId === i.productId)) {
        rows.push({
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          qtyOrdered: i.qtyOrdered,
          qtyReceived: i.qtyReceived,
          onReceipt: true,
          cost: i.cost,
          costWas: i.costWas,
        });
      }
    }
    return rows;
  }, [poItems, grn.items]);

  const changed = lines.some((l) => (Number(qty[l.productId]) || 0) !== l.qtyReceived);

  async function submit() {
    const items = lines.map((l) => ({
      productId: l.productId,
      qtyReceived: Math.max(0, Number(qty[l.productId]) || 0),
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
              <th className="px-3 py-2 text-center font-semibold">Ordered</th>
              <th className="px-3 py-2 text-center font-semibold">Received</th>
              <th className="px-3 py-2 text-center font-semibold">Correct to</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((it) => {
              const v = Number(qty[it.productId]) || 0;
              const diff = v - it.qtyReceived;
              return (
                <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink-800">{it.name}</p>
                    <p className="text-xs text-slate-400">
                      {it.sku}
                      {/* Ordered but never received — the line this screen could
                          not previously show at all. */}
                      {!it.onReceipt && <span className="ml-2 font-semibold text-amber-600">not received</span>}
                    </p>
                    {/* BOTH FIGURES, never just the new one. "$0.19" is a
                        number; "$0.17 → $0.19" is a decision somebody made
                        with the invoice in their hand, and it is the only
                        form of it the owner can actually check. */}
                    {it.costWas !== undefined && it.cost !== undefined && (
                      <p className="mt-0.5 text-xs font-semibold text-sky-700">
                        cost {usd(it.costWas)} <ArrowRight size={11} className="inline" /> {usd(it.cost)}
                        <span className="ml-1 font-normal text-slate-400">keyed at receiving</span>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-400">{it.qtyOrdered}</td>
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
/**
 * Accept the costs receiving keyed, into the catalogue.
 *
 * SHOWS THE WHOLE LIST, AND ASKS FOR NOTHING ELSE. This is the one screen where
 * a person decides the shop's costs are wrong and these are right — every
 * margin, report and stock valuation moves behind it. A dialog reading "accept
 * 3 costs?" would be asking somebody to approve a number rather than a
 * decision, and they would click it. The list IS the confirmation.
 *
 * It used to demand a manager's approval code as well. That invented a rule
 * this app does not have: the owner already decides on /permissions who may
 * edit company-wide products, and anybody holding that can change the very
 * same cost on the Master Data screen without a code. A second hidden gate in
 * front of people already granted the function is friction, not control —
 * the audit line is what makes this reviewable.
 */
function AcceptCostsModal({
  grn,
  onClose,
  onDone,
}: {
  grn: GoodsReceipt;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rows = grn.items.filter((i) => i.costWas !== undefined && i.cost !== undefined);

  async function accept() {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/goods-receipts/${grn.id}/apply-costs`, { method: "POST" });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Accept costs · ${grn.grnNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={accept}>
            <ShieldCheck size={16} /> {busy ? "Applying…" : `Accept ${rows.length} cost${rows.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Receiving keyed these off <b className="text-ink-700">{grn.supplier}</b>&rsquo;s invoice on{" "}
        {grn.poNo}. Accepting makes them the catalogue&rsquo;s costs — every margin, report and
        stock value follows. The receipt itself does not change.
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-right font-semibold">Catalogue</th>
              <th className="px-3 py-2 text-right font-semibold">Invoiced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2">
                  <p className="font-semibold text-ink-800">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.sku}</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400 line-through">
                  {usd(r.costWas!)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-sky-700">
                  {usd(r.cost!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Said before the code box, not after. A product bought by the case has
          its per-unit cost DERIVED from the case price, so that is what moves —
          and somebody approving this should know which figure they are changing
          before they approve it, not discover it in Master Data later. */}
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Where a product is bought by the case, the case price is what changes — the per-unit
        figure is worked out from it, as it always is.
      </p>

      {err && <p className="mt-3 text-sm font-medium text-rose-600">{err}</p>}
    </Modal>
  );
}

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

/**
 * The invoice photo that was sent to Accounting, shown to whoever sent it.
 *
 * Until now this picture existed on disk and on Accounting's screen, and
 * nowhere the receiving desk could reach — so the person who took the photo
 * could not check it was straight, legible, or even the right invoice, and a
 * rejection sent them back to the supplier's paperwork with nothing to compare
 * against.
 *
 * Every page, not just the first. `images` carries them all and `image` is the
 * first, kept for older receipts written before multi-page existed; reading one
 * and falling back to the other is what stops a two-page invoice looking like a
 * one-page one.
 *
 * The review verdict is repeated at the top, including the rejection note. That
 * note is the whole reason somebody opens this screen — "which of these two did
 * they reject, and why" is unanswerable from a badge on a list.
 */
function InvoiceViewer({ grn, onClose }: { grn: GoodsReceipt; onClose: () => void }) {
  const inv = grn.invoice;
  if (!inv) return null;
  const pages = inv.images?.length ? inv.images : [inv.image];
  const tone =
    inv.status === "Approved"
      ? "bg-emerald-100 text-emerald-700"
      : inv.status === "Rejected"
        ? "bg-rose-100 text-rose-700"
        : "bg-slate-100 text-slate-600";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink-900">
              Invoice for {grn.grnNo}
              <span className="ml-2 font-normal text-slate-400">{grn.supplier}</span>
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className={`inline-flex rounded-md px-1.5 py-0.5 font-semibold ${tone}`}>
                {inv.status === "Pending" ? "Pending review" : inv.status}
              </span>
              <span>Sent by {inv.uploadedBy}</span>
              {pages.length > 1 && <span>{pages.length} pages</span>}
            </div>
            {/* The reason, when there is one. A rejection with the note left on
                Accounting's screen is a re-scan somebody has to guess at. */}
            {inv.status === "Rejected" && inv.reviewNote && (
              <p className="mt-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                Rejected{inv.reviewedBy ? ` by ${inv.reviewedBy}` : ""}: {inv.reviewNote}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost !py-2 text-sm">
            <X size={15} /> Close
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
          {pages.map((name, i) => (
            <figure key={name} className="overflow-hidden rounded-xl bg-white shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/invoice-image/${encodeURIComponent(name)}`}
                alt={`${grn.grnNo} invoice page ${i + 1}`}
                className="block w-full"
              />
              {pages.length > 1 && (
                <figcaption className="px-3 py-1.5 text-[11px] text-slate-400">
                  Page {i + 1} of {pages.length}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
