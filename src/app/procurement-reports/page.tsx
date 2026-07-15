"use client";

import { useMemo, useState } from "react";
import { ClipboardList, FileText, DollarSign, PackageCheck, Truck, Clock, FileSpreadsheet, Filter } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { PurchaseOrder, PurchaseRequest, Supplier, POStatus, PRStatus } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, Badge, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { usd, num, shortDate } from "@/lib/format";

type Tab = "po" | "pr";

const PO_TONE: Record<POStatus, "brand" | "amber" | "emerald" | "slate"> = {
  Open: "brand",
  Partial: "amber",
  Received: "emerald",
  Cancelled: "slate",
};
const PR_TONE: Record<PRStatus, "slate" | "amber" | "emerald" | "rose" | "brand"> = {
  Draft: "slate",
  Submitted: "amber",
  Approved: "emerald",
  Rejected: "rose",
  Cancelled: "slate",
  Converted: "brand",
};

const inRange = (iso: string, from: string, to: string) => {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

const poValue = (po: PurchaseOrder) => po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);
const poReceivedValue = (po: PurchaseOrder) =>
  po.items.reduce((s, i) => s + i.cost * Math.min(i.qtyReceived, i.qtyOrdered), 0);
const prValue = (pr: PurchaseRequest) => pr.items.reduce((s, i) => s + i.cost * i.qty, 0);

export default function ProcurementReportsPage() {
  const { data: pos, loading: lo } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const { data: prs, loading: lp } = useFetch<PurchaseRequest[]>("/api/purchase-requests");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");

  const [tab, setTab] = useState<Tab>("po");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [requestedBy, setRequestedBy] = useState("All");
  const [status, setStatus] = useState("All");

  const supplierNames = useMemo(
    () => Array.from(new Set((pos || []).map((p) => p.supplier))).sort(),
    [pos],
  );
  const requesters = useMemo(
    () => Array.from(new Set((prs || []).map((p) => p.requestedBy))).sort(),
    [prs],
  );

  const filteredPOs = useMemo(
    () =>
      (pos || [])
        .filter((p) => inRange(p.createdAt, from, to))
        .filter((p) => supplier === "All" || p.supplier === supplier)
        .filter((p) => status === "All" || p.status === status)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [pos, from, to, supplier, status],
  );

  const filteredPRs = useMemo(
    () =>
      (prs || [])
        .filter((p) => inRange(p.createdAt, from, to))
        .filter((p) => requestedBy === "All" || p.requestedBy === requestedBy)
        .filter((p) => status === "All" || p.status === status)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [prs, from, to, requestedBy, status],
  );

  // Build the export URL from the active filters.
  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (status !== "All") p.set("status", status);
    if (tab === "po") {
      if (supplier !== "All") p.set("supplier", supplier);
      return `/api/reports/purchase-orders/export?${p.toString()}`;
    }
    if (requestedBy !== "All") p.set("requestedBy", requestedBy);
    return `/api/reports/purchase-requests/export?${p.toString()}`;
  }, [tab, from, to, supplier, requestedBy, status]);

  const poTotal = filteredPOs.reduce((s, p) => s + poValue(p), 0);
  const poReceived = filteredPOs.reduce((s, p) => s + poReceivedValue(p), 0);
  const prTotalVal = filteredPRs.reduce((s, p) => s + prValue(p), 0);
  const prApproved = filteredPRs.filter((p) => p.status === "Approved" || p.status === "Converted").length;
  const prPending = filteredPRs.filter((p) => p.status === "Submitted").length;

  const loading = tab === "po" ? lo : lp;

  function resetFilters() {
    setFrom("");
    setTo("");
    setSupplier("All");
    setRequestedBy("All");
    setStatus("All");
  }

  return (
    <div>
      <PageHeader
        title="Procurement Reports"
        subtitle="Purchase order & purchase request activity — filter, review and export"
        actions={
          <a href={exportUrl} className="btn-primary">
            <FileSpreadsheet size={18} /> Export Excel
          </a>
        }
      />

      {/* Tabs */}
      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-card">
        {([
          { key: "po", label: "Purchase Orders", icon: ClipboardList },
          { key: "pr", label: "Purchase Requests", icon: FileText },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setStatus("All");
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? "bg-brand-600 text-white shadow-brand-glow" : "text-slate-500 hover:text-ink-800"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} />
          </div>
          {tab === "po" ? (
            <div>
              <label className="label">Supplier</label>
              <select className="input sm:w-56" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option>All</option>
                {supplierNames.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="label">Requested by</label>
              <select className="input sm:w-48" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)}>
                <option>All</option>
                {requesters.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Status</label>
            <select className="input sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>All</option>
              {(tab === "po"
                ? ["Open", "Partial", "Received", "Cancelled"]
                : ["Draft", "Submitted", "Approved", "Rejected", "Converted"]
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <button onClick={resetFilters} className="btn-ghost">
            <Filter size={16} /> Reset
          </button>
        </div>
      </Card>

      {/* Stats */}
      {tab === "po" ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Purchase Orders" value={num(filteredPOs.length)} icon={<ClipboardList size={18} />} accent="brand" />
          <StatCard label="Total Value" value={usd(poTotal)} icon={<DollarSign size={18} />} accent="violet" />
          <StatCard label="Received Value" value={usd(poReceived)} icon={<PackageCheck size={18} />} accent="emerald" />
          <StatCard label="Outstanding" value={usd(poTotal - poReceived)} icon={<Truck size={18} />} accent="amber" />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Purchase Requests" value={num(filteredPRs.length)} icon={<FileText size={18} />} accent="brand" />
          <StatCard label="Approved / Ordered" value={num(prApproved)} icon={<PackageCheck size={18} />} accent="emerald" />
          <StatCard label="Awaiting Approval" value={num(prPending)} icon={<Clock size={18} />} accent="amber" />
          <StatCard label="Est. Value" value={usd(prTotalVal)} icon={<DollarSign size={18} />} accent="violet" />
        </div>
      )}

      {/* Table */}
      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading report…" />
        ) : tab === "po" ? (
          filteredPOs.length === 0 ? (
            <EmptyState title="No purchase orders match" hint="Adjust the filters above." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">PO Number</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Supplier</th>
                    <th className="px-4 py-3 text-center font-semibold">Items</th>
                    <th className="px-4 py-3 text-center font-semibold">Ordered</th>
                    <th className="px-4 py-3 text-center font-semibold">Received</th>
                    <th className="px-4 py-3 text-right font-semibold">Value</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPOs.map((po) => {
                    const ordered = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
                    const received = po.items.reduce((s, i) => s + i.qtyReceived, 0);
                    return (
                      <tr key={po.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-ink-800">{po.poNo}</td>
                        <td className="px-4 py-3 text-slate-600">{shortDate(po.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-600">{po.supplier}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{po.items.length}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{ordered}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{received}</td>
                        <td className="px-4 py-3 text-right font-semibold text-ink-800">{usd(poValue(po))}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge tone={PO_TONE[po.status]}>{po.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-slate-500" colSpan={6}>
                      {filteredPOs.length} orders
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-ink-900">{usd(poTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : filteredPRs.length === 0 ? (
          <EmptyState title="No purchase requests match" hint="Adjust the filters above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">PR Number</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Requested by</th>
                  <th className="px-4 py-3 text-center font-semibold">Items</th>
                  <th className="px-4 py-3 text-right font-semibold">Est. Value</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPRs.map((pr) => (
                  <tr key={pr.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-ink-800">{pr.prNo}</td>
                    <td className="px-4 py-3 text-slate-600">{shortDate(pr.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{pr.requestedBy}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{pr.items.length}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-800">{usd(prValue(pr))}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={PR_TONE[pr.status]}>{pr.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-100 bg-slate-50/60">
                  <td className="px-4 py-3 text-xs font-semibold uppercase text-slate-500" colSpan={4}>
                    {filteredPRs.length} requests
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink-900">{usd(prTotalVal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
