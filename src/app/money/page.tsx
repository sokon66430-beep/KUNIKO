"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  PlusCircle,
  MinusCircle,
  Vault,
  RotateCcw,
  Lock,
  Unlock,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
} from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { confirmDialog } from "@/components/confirm";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { usd, num, dateTime, timeOnly } from "@/lib/format";
import { CASH_DENOMS, countTotal } from "@/lib/money";
import { canApproveCash, canReopenShift } from "@/lib/access";
import type { CashCount, CashMovementType } from "@/lib/types";

type Drawer = {
  opening: number; cashSales: number; cashIn: number; cashOut: number; drop: number; refunds: number; expected: number;
  sales: { total: number; cash: number; card: number; ewallet: number };
  counts: { movements: number; drops: number; refunds: number };
};
type ShiftView = {
  id: string; posTerminalId: string; shift: "A" | "B" | "C"; cashier: string; cashierId: string;
  status: "open" | "pending_close" | "closed";
  openedAt: string; openingFloat: number; submittedAt?: string; closedAt?: string; closedBy?: string;
  expectedCash?: number; actualCash?: number; variance?: number; varianceReason?: string;
  reopenedAt?: string; reopenedBy?: string;
  drawer: Drawer;
};
type ShiftsData = { drawerLimit: number; shifts: ShiftView[] };

const TERMINAL_KEY = "stookii_pos_terminal";
const emptyCount = (): CashCount => ({ denoms: CASH_DENOMS.map((d) => ({ denom: d, count: 0 })), coins: 0 });

// A quick denomination counter — one row per note plus loose coins, with a live
// total. Used to count the opening float and the closing drawer.
function DenomCounter({ value, onChange }: { value: CashCount; onChange: (c: CashCount) => void }) {
  const total = countTotal(value);
  const setCount = (denom: number, count: number) =>
    onChange({ ...value, denoms: value.denoms.map((d) => (d.denom === denom ? { ...d, count: Math.max(0, Math.floor(count) || 0) } : d)) });
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="space-y-1.5">
        {value.denoms.map((d) => (
          <div key={d.denom} className="flex items-center gap-3">
            <span className="w-12 text-sm font-semibold text-slate-500">${d.denom}</span>
            <span className="text-slate-400">×</span>
            <input
              type="number"
              min={0}
              value={d.count || ""}
              onChange={(e) => setCount(d.denom, Number(e.target.value))}
              className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-center text-sm outline-none focus:border-brand-400"
            />
            <span className="ml-auto text-sm font-semibold tabular-nums text-ink-800">{usd(d.denom * d.count)}</span>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <span className="w-12 text-sm font-semibold text-slate-500">Coins</span>
          <span className="text-slate-400">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.coins || ""}
            onChange={(e) => onChange({ ...value, coins: Math.max(0, Number(e.target.value) || 0) })}
            className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-center text-sm outline-none focus:border-brand-400"
          />
          <span className="ml-auto text-sm font-semibold tabular-nums text-ink-800">{usd(value.coins || 0)}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-200 pt-2">
        <span className="text-sm font-bold uppercase tracking-wide text-slate-500">Counted total</span>
        <span className="text-lg font-extrabold tabular-nums text-brand-600">{usd(total)}</span>
      </div>
    </div>
  );
}

export default function MoneyPage() {
  const role = useRole();
  const isSupervisor = role ? canApproveCash(role) : false;
  const isManager = role ? canReopenShift(role) : false;
  const { data, loading, error, reload } = useFetch<ShiftsData>("/api/shifts");
  const [tab, setTab] = useState<"drawer" | "report">("drawer");

  const [terminal, setTerminal] = useState("POS 1");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(TERMINAL_KEY) : null;
    if (saved) setTerminal(saved);
  }, []);
  const saveTerminal = (v: string) => {
    setTerminal(v);
    if (typeof window !== "undefined") window.localStorage.setItem(TERMINAL_KEY, v);
  };

  const shifts = data?.shifts ?? [];
  const drawerLimit = data?.drawerLimit ?? 0;
  const current = shifts.find((s) => s.posTerminalId === terminal && s.status === "open");
  const pendingCloses = shifts.filter((s) => s.status === "pending_close");

  // Open-shift form
  const [openShiftName, setOpenShiftName] = useState<"A" | "B" | "C">("A");
  const [openCount, setOpenCount] = useState<CashCount>(emptyCount());
  const [busy, setBusy] = useState(false);

  async function openShift() {
    setBusy(true);
    try {
      await api("/api/shifts", { method: "POST", body: JSON.stringify({ posTerminalId: terminal, shift: openShiftName, openingCount: openCount }) });
      setOpenCount(emptyCount());
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Movement modal
  const [mv, setMv] = useState<CashMovementType | null>(null);
  async function submitMovement(payload: { amount: number; reason: string; notes?: string }) {
    if (!current) return;
    await api("/api/cash-movements", { method: "POST", body: JSON.stringify({ shiftId: current.id, type: mv, ...payload }) });
    setMv(null);
    reload();
  }

  // Close modal
  const [closing, setClosing] = useState(false);

  async function approveClose(id: string) {
    if (!(await confirmDialog({ title: "Approve & lock shift", message: "Approve this close? The shift will be locked — no more edits.", confirmText: "Approve & lock" }))) return;
    try {
      await api(`/api/shifts/${id}/approve`, { method: "POST" });
      reload();
    } catch (e: any) { alert(e.message); }
  }
  async function reopen(id: string) {
    const note = window.prompt("Reason for reopening this shift (recorded in the audit log):");
    if (!note) return;
    try {
      await api(`/api/shifts/${id}/reopen`, { method: "POST", body: JSON.stringify({ note }) });
      reload();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader
        title="Money Management"
        subtitle="Cash shifts, drawer control and accountability — per POS terminal"
        actions={
          <div className="flex items-center gap-2">
            <input
              value={terminal}
              onChange={(e) => saveTerminal(e.target.value)}
              title="This till's name — saved on this device"
              className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-sm font-semibold text-ink-800 outline-none focus:border-brand-400"
            />
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {(["drawer", "report"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {t === "drawer" ? "Drawer" : "Reports"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner label="Loading money management…" />}

      {tab === "report" ? (
        <ReportTab />
      ) : (
        <div className="space-y-6">
          {/* Supervisor: shifts awaiting close approval */}
          {isSupervisor && pendingCloses.length > 0 && (
            <Card title="Awaiting your approval" icon={<ClipboardCheck size={15} className="text-amber-500" />}>
              <Table>
                <THead>
                  <Th>Shift</Th><Th>Terminal</Th><Th>Cashier</Th><Th align="right">Expected</Th><Th align="right">Counted</Th><Th align="right">Variance</Th><Th>Reason</Th><Th align="right"></Th>
                </THead>
                <TBody>
                  {pendingCloses.map((s) => (
                    <Tr key={s.id}>
                      <Td>Shift {s.shift}</Td>
                      <Td>{s.posTerminalId}</Td>
                      <Td>{s.cashier}</Td>
                      <Td align="right">{usd(s.expectedCash ?? 0)}</Td>
                      <Td align="right">{usd(s.actualCash ?? 0)}</Td>
                      <Td align="right"><VarianceTag v={s.variance ?? 0} /></Td>
                      <Td className="text-slate-500">{s.varianceReason || "—"}</Td>
                      <Td align="right"><button className="btn-primary !py-1.5 text-xs" onClick={() => approveClose(s.id)}><Lock size={13} /> Approve</button></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {current ? (
            <DrawerView shift={current} drawerLimit={drawerLimit} onMovement={setMv} onClose={() => setClosing(true)} />
          ) : (
            <Card title={`Open a shift on ${terminal}`} subtitle="Count the opening float by denomination, then open the shift." icon={<Wallet size={15} />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Shift</label>
                  <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-1">
                    {(["A", "B", "C"] as const).map((s) => (
                      <button key={s} onClick={() => setOpenShiftName(s)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${openShiftName === s ? "bg-white text-ink-900 shadow-sm" : "text-slate-500"}`}>Shift {s}</button>
                    ))}
                  </div>
                  <button className="btn-primary w-full" disabled={busy || countTotal(openCount) <= 0} onClick={openShift}>
                    <Unlock size={16} /> {busy ? "Opening…" : `Open shift · float ${usd(countTotal(openCount))}`}
                  </button>
                  <p className="mt-2 text-xs text-slate-400">Sales made on this till attribute to this shift once it&apos;s open.</p>
                </div>
                <DenomCounter value={openCount} onChange={setOpenCount} />
              </div>
            </Card>
          )}

          {/* Recent shifts */}
          <Card title="Recent shifts" subtitle="Newest first">
            {shifts.length === 0 ? (
              <EmptyState title="No shifts yet" hint="Open a shift above to start tracking the drawer." icon={<Wallet size={18} />} />
            ) : (
              <Table>
                <THead>
                  <Th>Shift</Th><Th>Terminal</Th><Th>Cashier</Th><Th>Opened</Th><Th align="right">Expected</Th><Th align="right">Variance</Th><Th>Status</Th><Th align="right"></Th>
                </THead>
                <TBody>
                  {shifts.map((s) => (
                    <Tr key={s.id}>
                      <Td>Shift {s.shift}</Td>
                      <Td>{s.posTerminalId}</Td>
                      <Td>{s.cashier}</Td>
                      <Td className="whitespace-nowrap text-slate-500">{dateTime(s.openedAt)}</Td>
                      <Td align="right">{usd(s.expectedCash ?? s.drawer.expected)}</Td>
                      <Td align="right">{s.variance != null ? <VarianceTag v={s.variance} /> : "—"}</Td>
                      <Td><StatusBadge status={s.status} /></Td>
                      <Td align="right">
                        {s.status === "closed" && isManager && (
                          <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50" onClick={() => reopen(s.id)}>
                            <Unlock size={13} /> Reopen
                          </button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {mv && current && <MovementModal type={mv} onClose={() => setMv(null)} onSubmit={submitMovement} drawer={current.drawer} drawerLimit={drawerLimit} />}
      {closing && current && <CloseModal shift={current} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload(); }} />}
    </div>
  );
}

function StatusBadge({ status }: { status: "open" | "pending_close" | "closed" }) {
  if (status === "open") return <Badge tone="emerald">Open</Badge>;
  if (status === "pending_close") return <Badge tone="amber">Pending close</Badge>;
  return <Badge tone="slate">Locked</Badge>;
}
function VarianceTag({ v }: { v: number }) {
  if (v === 0) return <span className="font-semibold text-emerald-600">$0.00</span>;
  return <span className={`font-bold tabular-nums ${v < 0 ? "text-rose-600" : "text-amber-600"}`}>{v > 0 ? "+" : ""}{usd(v)}</span>;
}

function DrawerView({ shift, drawerLimit, onMovement, onClose }: {
  shift: ShiftView; drawerLimit: number; onMovement: (t: CashMovementType) => void; onClose: () => void;
}) {
  const d = shift.drawer;
  const over = drawerLimit > 0 && d.expected > drawerLimit;
  const recDrop = over ? Math.max(0, Math.round((d.expected - drawerLimit) * 100) / 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="emerald">Shift {shift.shift}</Badge>
          <span className="text-sm text-slate-500">{shift.posTerminalId} · {shift.cashier} · opened {timeOnly(shift.openedAt)}</span>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${over ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>
          {over ? <><AlertTriangle size={13} /> Over limit</> : <><CheckCircle2 size={13} /> Normal</>}
        </span>
      </div>

      {over && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>Cash drawer exceeds the {usd(drawerLimit)} limit. Perform a safe drop of about <b>{usd(recDrop)}</b> to the store safe.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Opening Float" value={usd(d.opening)} accent="violet" />
        <StatCard label="Cash Sales" value={usd(d.cashSales)} sub={`${usd(d.sales.total)} all payments`} accent="brand" />
        <StatCard label="Card" value={usd(d.sales.card)} accent="violet" />
        <StatCard label="E-wallet" value={usd(d.sales.ewallet)} accent="violet" />
        <StatCard label="Cash In" value={`+${usd(d.cashIn)}`} accent="emerald" />
        <StatCard label="Cash Out" value={`-${usd(d.cashOut)}`} accent="amber" />
        <StatCard label="Safe Drops / Refunds" value={`-${usd(d.drop + d.refunds)}`} accent="amber" />
        <StatCard label="Expected Drawer" value={usd(d.expected)} accent={over ? "rose" : "emerald"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => onMovement("CASH_IN")}><PlusCircle size={16} /> Cash In</button>
        <button className="btn-ghost" onClick={() => onMovement("CASH_OUT")}><MinusCircle size={16} /> Cash Out</button>
        <button className="btn-ghost" onClick={() => onMovement("DROP")}><Vault size={16} /> Safe Drop</button>
        <button className="btn-ghost" onClick={() => onMovement("REFUND")}><RotateCcw size={16} /> Cash Refund</button>
        <button className="btn-primary ml-auto" onClick={onClose}><Lock size={16} /> Close shift &amp; count</button>
      </div>
    </div>
  );
}

const MV_META: Record<CashMovementType, { title: string; hint: string }> = {
  CASH_IN: { title: "Cash In", hint: "Change money, additional float, returned petty cash." },
  CASH_OUT: { title: "Cash Out", hint: "Store expense, emergency purchase, petty cash." },
  DROP: { title: "Safe Drop", hint: "Move excess cash from the drawer to the store safe." },
  REFUND: { title: "Cash Refund", hint: "Cash returned to a customer." },
};

function MovementModal({ type, onClose, onSubmit, drawer, drawerLimit }: {
  type: CashMovementType; onClose: () => void; onSubmit: (p: { amount: number; reason: string; notes?: string }) => Promise<void>;
  drawer: Drawer; drawerLimit: number;
}) {
  const meta = MV_META[type];
  const recDrop = type === "DROP" && drawerLimit > 0 ? Math.max(0, Math.round((drawer.expected - drawerLimit) * 100) / 100) : 0;
  const [amount, setAmount] = useState(recDrop > 0 ? String(recDrop) : "");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = Math.round((Number(amount) || 0) * 100) / 100;

  async function go() {
    setBusy(true);
    try { await onSubmit({ amount: amt, reason: reason.trim(), notes: notes.trim() || undefined }); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={meta.title} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || amt <= 0 || !reason.trim()} onClick={go}>{busy ? "Saving…" : `Record ${usd(amt)}`}</button>
      </div>
    }>
      <p className="mb-3 text-sm text-slate-500">{meta.hint}</p>
      {type === "DROP" && recDrop > 0 && (
        <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">Recommended drop to reach the {usd(drawerLimit)} limit: {usd(recDrop)}</p>
      )}
      <label className="label">Amount ($)</label>
      <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input mb-3" autoFocus />
      <label className="label">Reason</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === "CASH_OUT" ? "e.g. Buy cleaning supplies" : "Reason"} className="input mb-3" />
      <label className="label">Notes (optional)</label>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
    </Modal>
  );
}

function CloseModal({ shift, onClose, onDone }: { shift: ShiftView; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState<CashCount>(emptyCount());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = shift.drawer.expected;
  const actual = countTotal(count);
  const variance = Math.round((actual - expected) * 100) / 100;

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/shifts/${shift.id}/close`, { method: "POST", body: JSON.stringify({ closingCount: count, varianceReason: reason.trim() }) });
      onDone();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Close Shift ${shift.shift} · ${shift.posTerminalId}`} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || (variance !== 0 && !reason.trim())} onClick={submit}>
          <ClipboardCheck size={16} /> {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    }>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">Count the drawer</p>
          <DenomCounter value={count} onChange={setCount} />
        </div>
        <div className="space-y-2">
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <Row label="Expected cash" value={usd(expected)} />
            <Row label="Counted cash" value={usd(actual)} />
            <div className="mt-1 flex items-center justify-between border-t border-dashed border-slate-200 pt-2">
              <span className="font-bold text-slate-600">Variance</span>
              <VarianceTag v={variance} />
            </div>
          </div>
          {variance !== 0 && (
            <div>
              <label className="label">Variance reason (required)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the difference" className="input" />
            </div>
          )}
          <p className="text-xs text-slate-400">Submitting sends the count to a supervisor. Once approved, the shift locks and can&apos;t be edited.</p>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-ink-800">{value}</span>
    </div>
  );
}

function ReportTab() {
  const [date, setDate] = useState("");
  const url = useMemo(() => `/api/cash-report${date ? `?date=${date}` : ""}`, [date]);
  const { data, loading } = useFetch<any>(url);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-600">Day</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-48" />
          {date && <button className="btn-ghost !py-1.5 text-xs" onClick={() => setDate("")}>All time</button>}
        </div>
      </Card>

      {loading && !data ? (
        <Spinner label="Loading report…" />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Cash Sales" value={usd(data.totals.cashSales)} accent="brand" />
            <StatCard label="Cash In / Out" value={`${usd(data.totals.cashIn)} / ${usd(data.totals.cashOut)}`} accent="violet" />
            <StatCard label="Safe Drops" value={usd(data.totals.drop)} accent="violet" />
            <StatCard label="Total Variance" value={<VarianceTag v={data.totals.variance} />} accent={data.totals.variance < 0 ? "rose" : "emerald"} />
          </div>

          <Card title="Shift cash report" subtitle="Per shift · store · POS · cashier" icon={<BarChart3 size={15} />}>
            {data.rows.length === 0 ? (
              <EmptyState title="No shifts in range" icon={<Wallet size={18} />} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <Th>Shift</Th><Th>Terminal</Th><Th>Cashier</Th><Th align="right">Open Float</Th><Th align="right">Cash Sales</Th><Th align="right">In</Th><Th align="right">Out</Th><Th align="right">Drop</Th><Th align="right">Expected</Th><Th align="right">Actual</Th><Th align="right">Variance</Th>
                  </THead>
                  <TBody>
                    {data.rows.map((r: any) => (
                      <Tr key={r.id}>
                        <Td>{r.shift}</Td><Td>{r.posTerminalId}</Td><Td>{r.cashier}</Td>
                        <Td align="right">{usd(r.openingFloat)}</Td>
                        <Td align="right">{usd(r.cashSales)}</Td>
                        <Td align="right">{usd(r.cashIn)}</Td>
                        <Td align="right">{usd(r.cashOut)}</Td>
                        <Td align="right">{usd(r.drop)}</Td>
                        <Td align="right">{usd(r.expected)}</Td>
                        <Td align="right">{r.actual != null ? usd(r.actual) : "—"}</Td>
                        <Td align="right">{r.variance != null ? <VarianceTag v={r.variance} /> : "—"}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Cashier performance" subtitle="Sales, variance and cash handling">
            {data.cashierPerformance.length === 0 ? (
              <EmptyState title="No data" icon={<Wallet size={18} />} />
            ) : (
              <Table>
                <THead>
                  <Th>Cashier</Th><Th align="right">Shifts</Th><Th align="right">Total Sales</Th><Th align="right">Cash Variance</Th><Th align="right">Drops</Th><Th align="right">Refunds</Th>
                </THead>
                <TBody>
                  {data.cashierPerformance.map((c: any) => (
                    <Tr key={c.cashier}>
                      <Td>{c.cashier}</Td>
                      <Td align="right">{num(c.shifts)}</Td>
                      <Td align="right">{usd(c.salesTotal)}</Td>
                      <Td align="right"><VarianceTag v={c.variance} /></Td>
                      <Td align="right">{num(c.drops)}</Td>
                      <Td align="right">{num(c.refunds)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
