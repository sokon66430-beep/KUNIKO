"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Select } from "@/components/Select";

// How the lines of one PO can be ordered on screen.
type ItemSort = "original" | "name" | "ordered" | "outstanding" | "line";
import {
  Plus,
  ClipboardList,
  Truck,
  PackageCheck,
  DollarSign,
  Ban,
  Printer,
  FileSpreadsheet,
  Search,
  X,
  Check,
  FileText,
  ArrowRightCircle,
  PackageCheck as ReceiveIcon,
  Sparkles,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { DatePicker } from "@/components/DatePicker";
import type { Product, PurchaseOrder, POStatus, Supplier, PurchaseRequest } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { confirmDialog } from "@/components/confirm";
import { LineBuilder, Line } from "@/components/LineBuilder";
import { OpeningOrderModal } from "@/components/OpeningOrderModal";
import { usd, num, dateTime, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<POStatus, "brand" | "amber" | "emerald" | "slate"> = {
  Open: "brand",
  Partial: "amber",
  Received: "emerald",
  Cancelled: "slate",
};

const poTotal = (po: PurchaseOrder) => po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);
const prTotal = (pr: PurchaseRequest) => pr.items.reduce((s, i) => s + i.cost * i.qty, 0);
const receivedPct = (po: PurchaseOrder) => {
  const ord = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
  const rec = po.items.reduce((s, i) => s + Math.min(i.qtyReceived, i.qtyOrdered), 0);
  return ord ? Math.round((rec / ord) * 100) : 0;
};

export default function PurchaseOrdersPage() {
  const { data: pos, loading, error, reload } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const { data: prs, reload: reloadPRs } = useFetch<PurchaseRequest[]>("/api/purchase-requests");
  const { data: products } = useFetch<Product[]>("/api/products");
  const { data: suppliers } = useFetch<Supplier[]>("/api/suppliers");
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [openingStore, setOpeningStore] = useState(false);
  const [presetSupplierCode, setPresetSupplierCode] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [viewingPR, setViewingPR] = useState<PurchaseRequest | null>(null);
  const [prBusy, setPrBusy] = useState(false);

  // Procurement's inbox: requests submitted by the operation team.
  const queue = (prs || []).filter((r) => r.status === "Submitted" || r.status === "Approved");

  async function decidePR(pr: PurchaseRequest, status: "Approved" | "Rejected") {
    setPrBusy(true);
    try {
      await api(`/api/purchase-requests/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setViewingPR(null);
      reloadPRs();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPrBusy(false);
    }
  }

  async function convertPR(pr: PurchaseRequest) {
    setPrBusy(true);
    try {
      const res = await api<{ pos: { poNo: string }[] }>(`/api/purchase-requests/${pr.id}/convert`, {
        method: "POST",
      });
      setViewingPR(null);
      reloadPRs();
      reload();
      alert(`Created ${res.pos.length} purchase order(s): ${res.pos.map((p) => p.poNo).join(", ")}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPrBusy(false);
    }
  }

  // Deep-link from the Suppliers page ("New PO for this supplier").
  useEffect(() => {
    const code = searchParams.get("supplier");
    if (code) {
      setPresetSupplierCode(code);
      setCreating(true);
    }
  }, [searchParams]);

  // Sort + "Today" filter for the PO list (new POs land every day).
  const [sortBy, setSortBy] = useState<"date-desc" | "date-asc" | "po" | "sent">("date-desc");
  const [todayOnly, setTodayOnly] = useState(false);
  const [search, setSearch] = useState(""); // find a PO by number / supplier / source PR
  const hasAnyPOs = (pos || []).length > 0;
  const isToday = (iso: string) => {
    const c = new Date(iso);
    const n = new Date();
    return c.getFullYear() === n.getFullYear() && c.getMonth() === n.getMonth() && c.getDate() === n.getDate();
  };
  const list = useMemo(() => {
    let l = [...(pos || [])];
    if (todayOnly) l = l.filter((p) => isToday(p.createdAt));
    const q = search.trim().toLowerCase();
    if (q) {
      l = l.filter(
        (p) =>
          p.poNo.toLowerCase().includes(q) ||
          p.supplier.toLowerCase().includes(q) ||
          (p.prNo || "").toLowerCase().includes(q),
      );
    }
    switch (sortBy) {
      case "date-asc":
        return l.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      case "po":
        return l.sort((a, b) => a.poNo.localeCompare(b.poNo));
      case "sent": // not-yet-sent first, so the team sees what still needs sending
        return l.sort((a, b) => Number(!!a.sentToSupplier) - Number(!!b.sentToSupplier) || +new Date(b.createdAt) - +new Date(a.createdAt));
      default:
        return l.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    }
  }, [pos, sortBy, todayOnly, search]);
  const open = list.filter((p) => p.status === "Open" || p.status === "Partial").length;
  const received = list.filter((p) => p.status === "Received").length;
  const openValue = list
    .filter((p) => p.status === "Open" || p.status === "Partial")
    .reduce((s, p) => s + poTotal(p), 0);

  // Tick once the PO has actually been sent out to the supplier.
  async function markSent(po: PurchaseOrder, sent: boolean) {
    await api(`/api/purchase-orders/${po.id}`, {
      method: "PATCH",
      body: JSON.stringify({ sentToSupplier: sent }),
    });
    reload();
  }

  async function cancel(po: PurchaseOrder) {
    if (
      !(await confirmDialog({
        title: "Cancel purchase order",
        message: `Cancel ${po.poNo}? It will no longer be sent to the supplier or received.`,
        confirmText: "Cancel PO",
        cancelText: "Keep it",
      }))
    )
      return;
    await api(`/api/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) });
    setViewing(null);
    reload();
  }

  async function del(po: PurchaseOrder) {
    if (
      !(await confirmDialog({
        title: "Delete purchase order",
        message: `Permanently delete ${po.poNo}? This removes it completely and cannot be undone. (Use Cancel instead if you just want to stop it.)`,
        confirmText: "Delete PO",
        cancelText: "Keep it",
      }))
    )
      return;
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
      setViewing(null);
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Procurement team — approve store requests, order from suppliers, track receiving"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" onClick={() => setOpeningStore(true)} title="Order best sellers to stock a new store">
              <Sparkles size={18} /> Stock a new store
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} /> New Order
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      {openingStore && (
        <OpeningOrderModal
          products={products || []}
          onClose={() => setOpeningStore(false)}
          onDone={() => {
            setOpeningStore(false);
            reload();
          }}
        />
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Orders" value={num(list.length)} icon={<ClipboardList size={18} />} accent="brand" />
        <StatCard label="Open / Partial" value={num(open)} icon={<Truck size={18} />} accent="amber" />
        <StatCard label="Fully Received" value={num(received)} icon={<PackageCheck size={18} />} accent="emerald" />
        <StatCard label="Open Value" value={usd(openValue)} icon={<DollarSign size={18} />} accent="violet" />
      </div>

      {queue.length > 0 && (
        <>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <FileText size={16} /> Requests from Operations ({queue.length})
          </h2>
          <div className="mb-6 space-y-2">
            {queue.map((pr) => (
              <div
                key={pr.id}
                className="card flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50/60"
                onClick={() => setViewingPR(pr)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-semibold text-ink-800">{pr.prNo}</p>
                    <p className="text-xs text-slate-400">
                      {pr.requestedBy} · {dateTime(pr.createdAt)}
                    </p>
                  </div>
                  <Badge tone={pr.status === "Submitted" ? "amber" : "emerald"}>{pr.status}</Badge>
                  <span className="text-sm text-slate-500">
                    {pr.items.length} item{pr.items.length === 1 ? "" : "s"} ·{" "}
                    <b className="text-ink-800">{usd(prTotal(pr))}</b>
                  </span>
                </div>
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {pr.status === "Submitted" && (
                    <>
                      <button
                        disabled={prBusy}
                        onClick={() => decidePR(pr, "Rejected")}
                        className="btn-danger !px-3 !py-1.5 text-xs"
                      >
                        <X size={14} /> Reject
                      </button>
                      <button
                        disabled={prBusy}
                        onClick={() => decidePR(pr, "Approved")}
                        className="btn-primary !px-3 !py-1.5 text-xs"
                      >
                        <Check size={14} /> Approve
                      </button>
                    </>
                  )}
                  {pr.status === "Approved" && (
                    <button
                      disabled={prBusy}
                      onClick={() => convertPR(pr)}
                      className="btn-primary !px-3 !py-1.5 text-xs"
                    >
                      <ArrowRightCircle size={14} /> Generate PO
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Sort bar — and the ✓ marks which POs were already sent to the supplier */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{todayOnly ? "Today" : "Orders"}</h2>
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
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 text-xs font-medium text-slate-500">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              className="input pl-9 !py-2 text-sm"
              placeholder="Search PO number or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            Sort by
            <SearchSelect
              className="w-44"
              value={sortBy}
              onChange={(v) => setSortBy(v as any)}
              options={[
                { value: "date-desc", label: "Date · newest first" },
                { value: "date-asc", label: "Date · oldest first" },
                { value: "po", label: "PO number" },
                { value: "sent", label: "Not sent first" },
              ]}
            />
          </div>
        </div>
      </div>

      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading orders…" />
        ) : list.length === 0 ? (
          search.trim() && hasAnyPOs ? (
            <EmptyState title="No matching PO" hint={`No purchase order matches “${search}”.`} />
          ) : todayOnly && hasAnyPOs ? (
            <EmptyState title="No orders today" hint="Switch to “All” to see earlier purchase orders." />
          ) : (
            <EmptyState title="No purchase orders yet" hint="Approve a request or create an order directly." />
          )
        ) : (
          <div>
            {list.map((po) => {
              const pct = receivedPct(po);
              return (
                <div
                  key={po.id}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-slate-50 px-4 py-3 transition last:border-0 hover:bg-slate-50/60 sm:gap-3 sm:px-5 sm:py-4"
                  onClick={() => setViewing(po)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-900 sm:text-base">
                      {po.poNo}
                      <span className="ml-2 text-[11px] font-normal text-slate-400 sm:text-xs">
                        {po.prNo ? `from ${po.prNo} · ` : ""}
                        {shortDate(po.createdAt)}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 sm:text-sm">
                      {po.supplier} · <span className="font-semibold text-ink-800">{usd(poTotal(po))}</span>
                    </p>
                  </div>
                  {/* Actions — wrap to a full-width row on phones so nothing is cut off */}
                  <div
                    className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Sent to supplier — tick it once the PO has gone out */}
                    <label
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500"
                      title="Tick when this PO has been sent to the supplier"
                    >
                      <input
                        type="checkbox"
                        checked={!!po.sentToSupplier}
                        onChange={(e) => markSent(po, e.target.checked)}
                        className="h-4 w-4 accent-brand-600"
                      />
                      <span className={po.sentToSupplier ? "font-semibold text-emerald-600" : ""}>
                        {po.sentToSupplier ? "Sent" : "Send?"}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:w-24">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-slate-300"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">{pct}%</span>
                    </div>
                    <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
                    <div className="flex items-center gap-1">
                      {(po.status === "Open" || po.status === "Partial") && (
                        <Link href="/receiving" className="btn-primary !px-3 !py-1.5 text-xs">
                          <ReceiveIcon size={14} /> Receive
                        </Link>
                      )}
                      <button
                        onClick={() => setViewing(po)}
                        aria-label="View purchase order"
                        className="hidden h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-500 sm:grid"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {creating && (
        <CreatePOModal
          products={products || []}
          suppliers={suppliers || []}
          initialSupplierCode={presetSupplierCode}
          onClose={() => {
            setCreating(false);
            setPresetSupplierCode(undefined);
          }}
          onCreated={() => {
            setCreating(false);
            setPresetSupplierCode(undefined);
            reload();
          }}
        />
      )}

      {viewing && (
        <ViewPOModal
          po={viewing}
          onClose={() => setViewing(null)}
          onCancel={() => cancel(viewing)}
          onDelete={() => del(viewing)}
          onSaved={reload}
        />
      )}

      {viewingPR && (
        <ReviewPRModal
          pr={viewingPR}
          busy={prBusy}
          onClose={() => setViewingPR(null)}
          onApprove={() => decidePR(viewingPR, "Approved")}
          onReject={() => decidePR(viewingPR, "Rejected")}
          onConvert={() => convertPR(viewingPR)}
        />
      )}
    </div>
  );
}

function ReviewPRModal({
  pr,
  busy,
  onClose,
  onApprove,
  onReject,
  onConvert,
}: {
  pr: PurchaseRequest;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onConvert: () => void;
}) {
  const suppliersInPR = Array.from(new Set(pr.items.map((i) => i.supplier)));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Review ${pr.prNo}`}
      footer={
        <div className="flex w-full items-center justify-between">
          <a href={`/api/purchase-requests/${pr.id}/export`} className="btn-ghost">
            <FileSpreadsheet size={16} /> Excel
          </a>
          <div className="flex gap-2">
            {pr.status === "Submitted" && (
              <>
                <button className="btn-danger" disabled={busy} onClick={onReject}>
                  <X size={16} /> Reject
                </button>
                <button className="btn-primary" disabled={busy} onClick={onApprove}>
                  <Check size={16} /> Approve
                </button>
              </>
            )}
            {pr.status === "Approved" && (
              <button className="btn-primary" disabled={busy} onClick={onConvert}>
                <ArrowRightCircle size={16} /> Generate PO{suppliersInPR.length > 1 ? "s" : ""}
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
        {suppliersInPR.length > 1 && (
          <span className="text-brand-600">
            {suppliersInPR.length} suppliers → will split into {suppliersInPR.length} POs
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
              <th className="px-3 py-2 text-right font-semibold">Line</th>
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
              <td className="px-3 py-2.5 text-right font-bold text-ink-900">{usd(prTotal(pr))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}

type SupplierGroup = { supplierCode: string; supplierName: string; lines: Line[] };

function CreatePOModal({
  products,
  suppliers,
  initialSupplierCode,
  onClose,
  onCreated,
}: {
  products: Product[];
  suppliers: Supplier[];
  initialSupplierCode?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [browsingSupplierCode, setBrowsingSupplierCode] = useState<string | null>(initialSupplierCode ?? null);
  const [expectedDate, setExpectedDate] = useState("");
  const [busy, setBusy] = useState(false);

  const productCountByCode = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      if (p.supplierCode) m.set(p.supplierCode, (m.get(p.supplierCode) || 0) + 1);
    });
    return m;
  }, [products]);

  function addLine(product: Product, qty = 1) {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) return prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + qty } : l));
      return [...prev, { product, qty }];
    });
  }

  // A cart can span many suppliers — scanning is never restricted by
  // supplier. Group by supplierCode so the order auto-splits into one PO
  // per supplier at creation time, exactly like PR → PO conversion already does.
  const groups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const l of lines) {
      const code = l.product.supplierCode || "";
      const key = code || `unlinked:${l.product.supplier}`;
      if (!map.has(key)) {
        map.set(key, { supplierCode: code, supplierName: l.product.supplier, lines: [] });
      }
      map.get(key)!.lines.push(l);
    }
    return [...map.values()];
  }, [lines]);

  const orderable = groups.filter((g) => g.supplierCode);
  const unlinked = groups.filter((g) => !g.supplierCode);
  const groupTotal = (g: SupplierGroup) => g.lines.reduce((s, l) => s + l.product.cost * l.qty, 0);

  async function save() {
    if (orderable.length === 0) return;
    setBusy(true);
    try {
      const created: string[] = [];
      for (const g of orderable) {
        const res = await api<{ poNo: string }>("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplier: g.supplierName,
            expectedDate: expectedDate || undefined,
            items: g.lines.map((l) => ({
              productId: l.product.id,
              sku: l.product.sku,
              name: l.product.name,
              unit: l.product.unit,
              qtyOrdered: l.qty,
              cost: l.product.cost,
              barcode: l.product.barcode,
            })),
          }),
        });
        created.push(res.poNo);
      }
      onCreated();
      if (created.length > 1) {
        alert(`Split across ${created.length} suppliers — created: ${created.join(", ")}`);
      }
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
      title="New Purchase Order"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || orderable.length === 0} onClick={save}>
            {busy
              ? "Creating…"
              : orderable.length > 1
                ? `Create ${orderable.length} Purchase Orders`
                : "Create Order"}
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-500">
          Scan or search any item — items from different suppliers are automatically split into separate orders.
        </p>
        <div>
          <label className="label mb-0.5">Expected date</label>
          <DatePicker value={expectedDate} onChange={setExpectedDate} />
        </div>
      </div>

      <LineBuilder products={products} lines={lines} setLines={setLines} />

      {/* Order summary — shows the split before it happens */}
      {groups.length > 0 && (
        <div className="mt-4">
          <p className="label mb-2">
            {orderable.length > 1
              ? `This will create ${orderable.length} purchase orders`
              : "Order summary"}
          </p>
          <div className="space-y-1.5">
            {orderable.map((g) => (
              <div
                key={g.supplierCode}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm"
              >
                <span className="font-semibold text-ink-800">{g.supplierName}</span>
                <span className="text-slate-500">
                  {g.lines.length} item{g.lines.length === 1 ? "" : "s"} ·{" "}
                  <b className="text-ink-800">{usd(groupTotal(g))}</b>
                </span>
              </div>
            ))}
            {unlinked.map((g) => (
              <div
                key={g.supplierName}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm"
              >
                <span className="font-semibold text-amber-800">
                  {g.supplierName === "—" ? "No supplier linked" : g.supplierName}
                </span>
                <span className="text-amber-700">
                  {g.lines.length} item{g.lines.length === 1 ? "" : "s"} excluded —{" "}
                  <a href="/inventory" className="underline">
                    link supplier
                  </a>{" "}
                  to order
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setBrowsingSupplierCode(browsingSupplierCode ? null : "")}
          className="text-xs font-semibold text-brand-600 underline"
        >
          {browsingSupplierCode !== null ? "Hide supplier browser" : "Browse a supplier's catalog"}
        </button>
        {browsingSupplierCode !== null && (
          <div className="mt-3">
            <SupplierBrowser
              suppliers={suppliers}
              products={products}
              productCountByCode={productCountByCode}
              supplierCode={browsingSupplierCode}
              onChooseSupplier={setBrowsingSupplierCode}
              onAdd={addLine}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

// Optional convenience: pick a supplier and click through its catalog to
// bulk-add items — purely additive, never restricts what the scan/search
// box above can add.
function SupplierBrowser({
  suppliers,
  products,
  productCountByCode,
  supplierCode,
  onChooseSupplier,
  onAdd,
}: {
  suppliers: Supplier[];
  products: Product[];
  productCountByCode: Map<string, number>;
  supplierCode: string;
  onChooseSupplier: (code: string) => void;
  onAdd: (product: Product, qty?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const supplier = suppliers.find((s) => s.code === supplierCode);

  if (!supplier) {
    const q = query.trim().toLowerCase();
    const withProducts = suppliers.filter((s) => (productCountByCode.get(s.code) || 0) > 0);
    const filtered = (q
      ? withProducts.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      : withProducts
    ).slice(0, 50);
    return (
      <div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            autoFocus
            className="input py-2 pl-9 text-sm"
            placeholder="Search suppliers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
          {filtered.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => onChooseSupplier(s.code)}
              className="flex w-full items-center justify-between border-b border-slate-50 px-3.5 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
            >
              <span className="font-medium text-ink-800">{s.name}</span>
              <Badge tone="slate">{productCountByCode.get(s.code) || 0}</Badge>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3.5 py-5 text-center text-sm text-slate-400">No suppliers match.</p>}
        </div>
      </div>
    );
  }

  const items = products.filter((p) => p.supplierCode === supplierCode).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-800">{supplier.name}</p>
        <button type="button" onClick={() => onChooseSupplier("")} className="text-xs text-slate-400 hover:text-slate-600">
          Change supplier
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
        {items.slice(0, 60).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onAdd(p)}
            className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3.5 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
          >
            <span className="min-w-0 truncate font-medium text-ink-800">{p.name}</span>
            <span className="shrink-0 text-xs text-slate-500">{usd(p.cost)}</span>
          </button>
        ))}
        {items.length === 0 && <p className="px-3.5 py-5 text-center text-sm text-slate-400">No products found.</p>}
      </div>
      {items.length > 60 && (
        <p className="mt-1 text-[11px] text-slate-400">Showing 60 of {items.length} — use search above to narrow.</p>
      )}
    </div>
  );
}

function ViewPOModal({
  po,
  onClose,
  onCancel,
  onDelete,
  onSaved,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const role = useRole();
  // Any signed-in user can adjust the ORDERED QTY on a PO. Unit cost is NEVER
  // editable here (for anyone — including owner/procurement): prices are managed
  // in Master Data only. Deleting the whole PO stays limited to owner / procurement.
  const canEdit = !!role;
  const canDelete = role === "owner" || role === "procurement";
  // A sent PO is locked like a cancelled one: the supplier is holding that
  // document, and editing our copy would only put the two out of step. Untick
  // "Sent" on the list to reopen it. Receiving is unaffected — that's the whole
  // point of having sent it.
  const locked = po.status === "Cancelled" || !!po.sentToSupplier;
  // Deletable only when NOTHING was received — otherwise the stock would orphan.
  const hasReceipts = po.items.some((i) => i.qtyReceived > 0);
  const showActions = canEdit && !locked; // per-line trash column
  // `items` is what we show; `draft` is the working copy while editing.
  const [items, setItems] = useState(po.items);
  const [draft, setDraft] = useState(po.items);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Raw text the user is typing, per line. A number input bound straight to a
  // number coerces every keystroke (you couldn't clear the field mid-type), so
  // keep the raw string for display and parse on save.
  const [raw, setRaw] = useState<Record<string, { qtyOrdered: string }>>({});

  const startEdit = () => {
    const copy = items.map((i) => ({ ...i }));
    setDraft(copy);
    setRaw(Object.fromEntries(copy.map((i) => [i.productId, { qtyOrdered: String(i.qtyOrdered) }])));
    setEditing(true);
  };
  const setLine = (productId: string, patch: Partial<(typeof items)[number]>) =>
    setDraft((d) => d.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  const removeLine = (productId: string) => setDraft((d) => d.filter((l) => l.productId !== productId));

  // Delete a single item straight from the view (no edit mode). Only when that
  // line has no receipts. Removes just this product, keeps the rest of the PO.
  async function deleteLine(it: (typeof items)[number]) {
    if (it.qtyReceived > 0) return;
    const ok = await confirmDialog({
      title: "Remove item",
      message: `Remove "${it.name}" from ${po.poNo}? The rest of the order stays.`,
      confirmText: "Remove item",
      cancelText: "Keep it",
    });
    if (!ok) return;
    try {
      const updated = await api<PurchaseOrder>(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        body: JSON.stringify({ items: [{ productId: it.productId, remove: true }] }),
      });
      setItems(updated.items);
      setDraft(updated.items);
      onSaved();
    } catch (e: any) {
      alert(e.message);
    }
  }

  const base = editing ? draft : items;

  // Search + sort over the lines. A real opening order runs to dozens of items,
  // and finding one by eye down an unsorted list is the slow, error-prone bit.
  //
  // Both are OFF while editing: the rows are index-free (keyed by productId) but
  // reordering or hiding rows mid-edit would mean typing into one line and
  // watching a different one move. Nothing is hidden from an edit you're saving.
  const [itemQuery, setItemQuery] = useState("");
  const [itemSort, setItemSort] = useState<ItemSort>("original");

  const shown = useMemo(() => {
    if (editing) return base;
    const q = itemQuery.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.sku.toLowerCase().includes(q) ||
            (i.barcode || "").toLowerCase().includes(q),
        )
      : base;
    const sorted = [...filtered];
    switch (itemSort) {
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "ordered":
        return sorted.sort((a, b) => b.qtyOrdered - a.qtyOrdered);
      case "outstanding":
        // What's still owed — the question you open a part-received PO to answer.
        return sorted.sort((a, b) => b.qtyOrdered - b.qtyReceived - (a.qtyOrdered - a.qtyReceived));
      case "line":
        return sorted.sort((a, b) => b.cost * b.qtyOrdered - a.cost * a.qtyOrdered);
      default:
        return sorted; // the order the document was raised in
    }
  }, [base, editing, itemQuery, itemSort]);

  // The total always covers the WHOLE order, never just what's filtered — a
  // total that quietly changed with a search box would be a lie.
  const totalValue = base.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);

  /**
   * Each line's number ON THE DOCUMENT — fixed to the order the PO was raised
   * in, so it matches the "NO" column of the printed sheet the supplier is
   * holding. Taken before any sort or search, which is the whole point: sorting
   * by name and finding line 12 still means line 12 to them on the phone.
   */
  const lineNo = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach((it, i) => m.set(it.productId, i + 1));
    return m;
  }, [base]);

  async function save() {
    setBusy(true);
    try {
      const edits = [
        // Only the ordered qty travels — unit cost is managed in Master Data.
        ...draft.map((d) => ({
          productId: d.productId,
          qtyOrdered: Math.max(d.qtyReceived, Math.floor(Number(d.qtyOrdered) || 0)),
        })),
        // Lines removed in the draft → tell the server to drop them.
        ...items.filter((o) => !draft.some((d) => d.productId === o.productId)).map((o) => ({ productId: o.productId, remove: true })),
      ];
      const updated = await api<PurchaseOrder>(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        body: JSON.stringify({ items: edits }),
      });
      setItems(updated.items); // reflect what the server actually saved (qty floored at received, etc.)
      setDraft(updated.items);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="2xl"
      onClose={onClose}
      title={`${po.poNo} · ${po.supplier}`}
      footer={
        <div className="flex w-full items-center justify-between">
          <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <button className="btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy || draft.length === 0} onClick={save}>
                  <Check size={16} /> {busy ? "Saving…" : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <Link href={`/purchase-orders/${po.id}/print`} className="btn-ghost">
                  <Printer size={16} /> Print PO
                </Link>
                <a href={`/api/purchase-orders/${po.id}/export`} className="btn-ghost">
                  <FileSpreadsheet size={16} /> Excel
                </a>
                {canEdit && !locked && (
                  <button className="btn-ghost" onClick={startEdit}>
                    <Pencil size={16} /> Edit
                  </button>
                )}
                {canDelete && !hasReceipts && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    onClick={onDelete}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                )}
                {(po.status === "Open" || po.status === "Partial") && (
                  <>
                    <button className="btn-danger" onClick={onCancel}>
                      <Ban size={16} /> Cancel PO
                    </button>
                    <Link href="/receiving" className="btn-primary">
                      <ReceiveIcon size={16} /> Receive Goods
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
        <span>Created {dateTime(po.createdAt)}</span>
        {po.prNo && <span>From <b className="text-ink-700">{po.prNo}</b></span>}
        {po.expectedDate && <span>Expected {shortDate(po.expectedDate)}</span>}
      </div>
      {editing && (
        <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
          Adjust the ordered quantity. You can’t go below what’s already received; remove a line only if none was
          received. Unit cost is managed in Master Data.
        </p>
      )}
      {/* Say WHY there's no Edit button. A missing control with no explanation
          reads as a bug; this reads as a rule. */}
      {po.sentToSupplier && !editing && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <Check size={14} className="mt-0.5 shrink-0" />
          <span>
            Sent to {po.supplier} — locked, and its item names and costs are frozen exactly as they went out. Untick
            <b> Sent</b> on the orders list if it genuinely needs changing. Receiving still works as normal.
          </span>
        </p>
      )}
      {po.note && !editing && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{po.note}</p>
      )}
      {/* Find a line / order the list — only when not editing (see `shown`). */}
      {!editing && base.length > 6 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder="Find an item — name, item ID or barcode…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
            {itemQuery && (
              <button onClick={() => setItemQuery("")} className="shrink-0 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="w-52">
            <Select
              value={itemSort}
              onChange={(v) => setItemSort(v as ItemSort)}
              options={[
                { value: "original", label: "Order as raised" },
                { value: "name", label: "Name (A–Z)" },
                { value: "ordered", label: "Most ordered" },
                { value: "outstanding", label: "Most outstanding" },
                { value: "line", label: "Highest line value" },
              ]}
            />
          </div>
          {itemQuery && (
            <span className="text-[12px] text-slate-500">
              {shown.length} of {base.length}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              {/* "No" matches the printed sheet's first column exactly. */}
              <th className="w-10 px-3 py-2 text-right font-semibold">No</th>
              <th className="px-3 py-2 font-semibold">Product</th>
              {editing && <th className="px-3 py-2 text-center font-semibold">Unit cost</th>}
              <th className="px-3 py-2 text-center font-semibold">Ordered</th>
              <th className="px-3 py-2 text-center font-semibold">Received</th>
              <th className="px-3 py-2 text-right font-semibold">Line</th>
              {showActions && <th className="px-3 py-2 text-center font-semibold">{editing ? "Remove" : ""}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => {
              const short = it.qtyOrdered - it.qtyReceived;
              return (
                <tr key={it.productId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-right align-top text-[12px] tabular-nums text-slate-400">
                    {lineNo.get(it.productId)}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink-800">{it.name}</p>
                    <p className="text-xs text-slate-400">
                      {it.sku}
                      {it.barcode ? <span className="ml-1.5">· {it.barcode}</span> : ""}
                    </p>
                  </td>
                  {editing && (
                    <td className="px-3 py-2 text-center">
                      {/* Unit cost is never editable on a PO — prices live in Master Data. */}
                      <span className="text-sm text-slate-500" title="Unit cost is managed in Master Data">
                        {usd(it.cost)}
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-center">
                    {editing ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={raw[it.productId]?.qtyOrdered ?? String(it.qtyOrdered)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRaw((r) => ({ ...r, [it.productId]: { ...r[it.productId], qtyOrdered: v } }));
                          setLine(it.productId, { qtyOrdered: Number(v) || 0 });
                        }}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      />
                    ) : (
                      <>
                        {it.qtyOrdered} {it.unit}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={it.qtyReceived >= it.qtyOrdered ? "text-emerald-600" : "text-amber-600"}>
                      {it.qtyReceived}
                    </span>
                    {short > 0 && it.qtyReceived > 0 && <span className="ml-1 text-xs text-rose-500">(-{short})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink-800">{usd(it.cost * it.qtyOrdered)}</td>
                  {showActions && (
                    <td className="px-2 py-2 text-center">
                      {it.qtyReceived === 0 ? (
                        <button
                          type="button"
                          onClick={() => (editing ? removeLine(it.productId) : deleteLine(it))}
                          aria-label={`Remove ${it.name}`}
                          title="Remove this item"
                          className="mx-auto grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 active:bg-rose-200"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300" title="Some already received — can’t remove">
                          —
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50">
              {/* +1 for the "No" column. */}
              <td className="px-3 py-2.5 text-xs font-semibold uppercase text-slate-500" colSpan={editing ? 5 : 4}>
                Total order value
                {itemQuery && (
                  // The total is the whole order, so say so when the list isn't.
                  <span className="ml-2 font-normal normal-case text-slate-400">
                    (all {base.length} lines)
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-bold text-ink-900">{usd(totalValue)}</td>
              {showActions && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}
