"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  ScanLine,
  Camera,
  Package,
  CheckCircle2,
  CalendarDays,
  CalendarRange,
  Layers,
  Search,
  FileSpreadsheet,
  ShieldCheck,
  X,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import type { Product, WriteOff } from "@/lib/types";
import { WRITE_OFF_REASONS } from "@/lib/types";
import { measureType, UNIT_TYPE_LABEL, qtyStep } from "@/lib/writeoff";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { num, dateTime } from "@/lib/format";

const PAGE = 50;
const UNIT_OPTIONS = [
  { value: "pcs", label: "Unit (pcs)" },
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
  { value: "L", label: "L" },
  { value: "ml", label: "ml" },
];

function timeOf(iso: string) {
  const d = new Date(iso);
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Pre-select the unit dropdown from the product's own unit / measure type.
function defaultUnit(unit: string | undefined): string {
  const lc = (unit || "").trim().toLowerCase();
  if (lc === "kg") return "kg";
  if (lc === "g") return "g";
  if (lc === "l") return "L";
  if (lc === "ml") return "ml";
  const t = measureType(unit);
  return t === "weight" ? "kg" : t === "volume" ? "L" : "pcs";
}

export default function WriteOffsPage() {
  const { data: products, reload: reloadProducts } = useFetch<Product[]>("/api/products");
  const { data: writeOffs, loading, error, reload: reloadWO } = useFetch<WriteOff[]>("/api/write-offs");

  // --- fast entry form state ---
  const [scan, setScan] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState("");
  const [unitChoice, setUnitChoice] = useState("pcs");
  const [reason, setReason] = useState<string>("Expired");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ambiguous, setAmbiguous] = useState<Product[] | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // --- today's table ---
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [reviewing, setReviewing] = useState<WriteOff | null>(null);

  const list = writeOffs || [];
  // Cancelled records stay visible for auditing but don't count in the totals.
  const counted = list.filter((w) => (w.status || "Active") !== "Cancelled");
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startWeek = startToday - ((now.getDay() + 6) % 7) * 86400000; // Monday
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const inRange = (w: WriteOff, from: number) => new Date(w.createdAt).getTime() >= from;
  const todayCount = counted.filter((w) => inRange(w, startToday)).length;
  const weekCount = counted.filter((w) => inRange(w, startWeek)).length;
  const monthCount = counted.filter((w) => inRange(w, startMonth)).length;
  const todayQty = counted.filter((w) => inRange(w, startToday)).reduce((s, w) => s + w.quantity, 0);

  const todays = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((w) => inRange(w, startToday))
      .filter((w) => !q || (w.barcode || "").includes(q) || w.productName.toLowerCase().includes(q));
    // list is already newest-first from the API
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query, startToday]);

  useEffect(() => {
    if (product) {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }
  }, [product]);

  const chosenType = measureType(unitChoice);

  // Live product suggestions (barcode · item code · name) while typing.
  const searchResults = useMemo(() => {
    const q = scan.trim().toLowerCase();
    if (q.length < 2 || !products) return [];
    const score = (p: Product) => {
      if ((p.barcode || "").includes(q)) return 0;
      if (p.sku.toLowerCase().includes(q)) return 1;
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) return 2;
      if (n.includes(q)) return 3;
      return -1;
    };
    return products
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, 8)
      .map((x) => x.p);
  }, [scan, products]);

  function findProduct(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? scan).trim();
    if (!code || !products) return;
    const lc = code.toLowerCase();
    const byBarcode = products.filter((p) => p.barcode === code);
    if (byBarcode.length > 1) {
      setAmbiguous(byBarcode);
      setNotice(null);
      if (!fromCamera) setScan("");
      return;
    }
    const match =
      byBarcode[0] ||
      products.find((p) => p.sku.toLowerCase() === lc) ||
      products.find((p) => p.name.toLowerCase() === lc);
    if (match) {
      if (fromCamera) setCameraOpen(false);
      pickProduct(match);
    } else {
      setNotice({ tone: "warn", text: `Not found: ${code}` });
      if (!fromCamera) setScan("");
    }
  }

  function pickProduct(p: Product) {
    setProduct(p);
    setScan("");
    setQty("");
    setUnitChoice(defaultUnit(p.unit));
    setNotice(null);
    setAmbiguous(null);
  }

  function clearForm() {
    setProduct(null);
    setQty("");
    setNotes("");
    setReason("Expired");
    setAmbiguous(null);
    scanRef.current?.focus();
  }

  async function save() {
    if (!product) {
      setNotice({ tone: "warn", text: "Scan a product first" });
      scanRef.current?.focus();
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setNotice({ tone: "warn", text: "Enter a quantity greater than 0" });
      return;
    }
    setBusy(true);
    try {
      await api("/api/write-offs", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, barcode: product.barcode, quantity: q, unit: unitChoice, reason, notes }),
      });
      setNotice({ tone: "ok", text: `✓ Wrote off ${q} ${unitChoice} of ${product.name}` });
      clearForm();
      reloadWO();
      reloadProducts();
    } catch (e: any) {
      setNotice({ tone: "warn", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function requestCancel(w: WriteOff) {
    if (
      !(await confirmDialog({
        title: "Request write-off cancellation",
        message: `Cancel write-off ${w.woNo}? A Manager or Assistant Manager must approve before the ${w.quantity} ${w.unit} returns to stock.`,
        confirmText: "Request cancel",
        cancelText: "Keep it",
      }))
    )
      return;
    try {
      await api(`/api/write-offs/${w.id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      reloadWO();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") clearForm();
      }}
    >
      <PageHeader
        title="Write-Off"
        subtitle="Record damaged, expired, missing or unsellable stock — scan, enter the amount, pick a reason, save"
      />

      {error && <ErrorBox message={error} />}

      {/* Dashboard cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today" value={num(todayCount)} sub={`${num(todayQty)} units`} icon={<CalendarDays size={18} />} accent="rose" />
        <StatCard label="This Week" value={num(weekCount)} icon={<CalendarRange size={18} />} accent="amber" />
        <StatCard label="This Month" value={num(monthCount)} icon={<Layers size={18} />} accent="violet" />
        <StatCard label="Total Records" value={num(list.length)} icon={<Package size={18} />} accent="brand" />
      </div>

      {/* Fast entry */}
      <Card className="mb-6">
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Left: scan + product */}
          <div>
            <label className="label flex items-center gap-1.5">
              <ScanLine size={13} /> Scan product barcode
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
                <input
                  ref={scanRef}
                  autoFocus
                  className="input h-12 pl-10 pr-12 text-base"
                  placeholder="Scan / type barcode · Item ID · name"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      findProduct();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  title="Scan with camera"
                  className="absolute right-1.5 top-1/2 grid h-9 w-10 -translate-y-1/2 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                >
                  <Camera size={18} />
                </button>
                {searchResults.length > 0 && (
                  <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-soft">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProduct(p)}
                        className="flex w-full items-center justify-between gap-3 border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-brand-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink-800">{p.name}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {p.barcode || "no barcode"} · {p.sku} · {p.category}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-slate-500">
                          {p.stock} {p.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {ambiguous && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-xs font-semibold text-amber-800">This barcode matches {ambiguous.length} products — pick one:</p>
                <div className="flex flex-wrap gap-2">
                  {ambiguous.map((p) => (
                    <button key={p.id} onClick={() => pickProduct(p)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:bg-amber-100">
                      <span className="font-semibold text-ink-800">{p.name}</span> <span className="text-slate-400">{p.sku}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Product display */}
            {product ? (
              <div className="mt-3 flex gap-3 rounded-xl border border-slate-200 p-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Package size={26} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink-900">{product.name}</p>
                  <p className="text-xs text-slate-400">{product.barcode || "no barcode"} · {product.sku}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500">{product.category}</span>
                    <Badge tone={product.stock <= 0 ? "rose" : "emerald"}>Stock {product.stock} {product.unit}</Badge>
                    <Badge tone="slate">{UNIT_TYPE_LABEL[chosenType]}</Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                Scan or type to load a product
              </div>
            )}
          </div>

          {/* Right: quantity + reason + save */}
          <div className="flex flex-col">
            <label className="label">Quantity</label>
            <div className="flex gap-2">
              <input
                ref={qtyRef}
                type="number"
                inputMode="decimal"
                min={0}
                step={qtyStep(chosenType)}
                disabled={!product}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                }}
                placeholder={chosenType === "unit" ? "e.g. 5" : chosenType === "weight" ? "e.g. 0.25" : "e.g. 0.5"}
                className="input h-12 flex-1 text-lg font-semibold tabular-nums disabled:bg-slate-50"
              />
              <select
                value={unitChoice}
                disabled={!product}
                onChange={(e) => setUnitChoice(e.target.value)}
                className="input h-12 w-28 text-base font-semibold disabled:bg-slate-50"
                title="Measurement unit"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>

            <label className="label mt-4">Reason</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {WRITE_OFF_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            <label className="label mt-4">Note (optional)</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. water-damaged carton" />

            <div className="mt-4 flex items-center gap-2">
              <button className="btn-primary h-11 flex-1" disabled={busy || !product} onClick={save}>
                <CheckCircle2 size={18} /> {busy ? "Saving…" : "Save write-off"}
              </button>
              <button className="btn-ghost h-11" onClick={clearForm} title="Clear (Esc)">
                Clear
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Shortcuts: <b>Enter</b> = save · <b>Esc</b> = clear. Stock reduces automatically.</p>
            {notice && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-sm font-medium ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {notice.text}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Today's records */}
      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-bold text-ink-900">Today's Write-Offs</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input className="input pl-9" placeholder="Search barcode or product…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <a
              href={`/api/write-offs/export?from=${encodeURIComponent(new Date(startToday).toISOString())}&note=Today`}
              className="btn-ghost !py-2 text-xs"
              title="Download today's write-offs as Excel"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </a>
          </div>
        </div>
        {loading ? (
          <Spinner label="Loading…" />
        ) : todays.length === 0 ? (
          <EmptyState title="No write-offs today" hint="Scan a product above to record one." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Barcode</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 text-right font-semibold">Qty</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Notes</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {todays.slice(0, limit).map((w) => {
                    const status = w.status || "Active";
                    return (
                      <tr key={w.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${status === "Cancelled" ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3 tabular-nums text-slate-600">{timeOf(w.createdAt)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{w.barcode || "—"}</td>
                        <td className="px-4 py-3">
                          <p className={`font-semibold text-ink-800 ${status === "Cancelled" ? "line-through" : ""}`}>{w.productName}</p>
                          <p className="text-xs text-slate-400">{w.category}</p>
                          {status === "PendingCancel" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              Cancel pending approval
                            </span>
                          )}
                          {status === "Cancelled" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              Cancelled · by {w.cancelledBy}
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${status === "Cancelled" ? "text-slate-400 line-through" : "text-rose-600"}`}>−{w.quantity} {w.unit}</td>
                        <td className="px-4 py-3"><Badge tone={status === "Cancelled" ? "slate" : "amber"}>{w.reason}</Badge></td>
                        <td className="px-4 py-3 text-slate-600">{w.createdBy}</td>
                        <td className="px-4 py-3 max-w-[180px] truncate text-slate-500">{w.notes || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {status === "Active" && (
                            <button onClick={() => requestCancel(w)} title="Request cancel (needs manager approval)" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                              <Trash2 size={15} />
                            </button>
                          )}
                          {status === "PendingCancel" && (
                            <button
                              onClick={() => setReviewing(w)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                            >
                              Approve
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>Showing {num(Math.min(limit, todays.length))} of {num(todays.length)}</span>
              {todays.length > limit && (
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setLimit((l) => l + PAGE)}>Load more</button>
              )}
            </div>
          </>
        )}
      </Card>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => findProduct(code)} />

      {reviewing && (
        <CancelApproveModal
          wo={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            reloadWO();
            reloadProducts();
          }}
        />
      )}
    </div>
  );
}

// Manager review of a cancel request — approve (restores stock) or reject,
// authenticated with the approval code from Store Settings.
function CancelApproveModal({ wo, onClose, onDone }: { wo: WriteOff; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState("");

  async function decide(decision: "approve" | "reject") {
    if (!code.trim()) {
      setErr("Enter or scan your approval code");
      return;
    }
    setBusy(decision);
    setErr("");
    try {
      await api(`/api/write-offs/${wo.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ decision, code }),
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
      title={`Approve cancel · ${wo.woNo}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
            disabled={busy !== null}
            onClick={() => decide("reject")}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button className="btn-primary" disabled={busy !== null} onClick={() => decide("approve")}>
            <ShieldCheck size={16} /> {busy === "approve" ? "Approving…" : "Approve cancel"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        <b className="text-ink-700">{wo.cancelRequestedBy || "—"}</b> asked to cancel this write-off. Approving returns{" "}
        <b className="text-ink-700">{wo.quantity} {wo.unit}</b> of <b className="text-ink-700">{wo.productName}</b> to stock.
      </p>
      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {wo.woNo} · {wo.reason}
        {wo.notes ? <> · “{wo.notes}”</> : null} · recorded by {wo.createdBy}
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
        <p className="mt-1 text-xs text-slate-400">Only a Manager or Assistant Manager code can approve. Set these in Store Settings.</p>
        {err && <p className="mt-2 text-sm font-medium text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
