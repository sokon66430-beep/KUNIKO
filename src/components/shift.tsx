"use client";

// Shared shift / cash-drawer building blocks.
//
// These used to live inside the Money Management page. They now live here so the
// POS till can show the SAME drawer summary and run the SAME close-and-count
// flow without the cashier leaving the sale screen — one source of truth, so the
// till and the money page can never drift apart on how the drawer is counted or
// what "expected" means.

import { useState } from "react";
import {
  PlusCircle,
  MinusCircle,
  Vault,
  RotateCcw,
  Lock,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
} from "lucide-react";
import { api } from "@/lib/client";
import { Badge, StatCard, Modal } from "@/components/ui";
import { usd, timeOnly } from "@/lib/format";
import { CASH_DENOMS, RIEL_DENOMS, countTotal } from "@/lib/money";
import type { CashCount, CashMovementType } from "@/lib/types";

export type Drawer = {
  opening: number; cashSales: number; cashIn: number; cashOut: number; drop: number; refunds: number; expected: number;
  sales: { total: number; cash: number; card: number; ewallet: number };
  counts: { movements: number; drops: number; refunds: number };
};
export type ShiftView = {
  id: string; posTerminalId: string; shift: "A" | "B" | "C"; cashier: string; cashierId: string;
  status: "open" | "pending_close" | "closed";
  openedAt: string; openingFloat: number; submittedAt?: string; closedAt?: string; closedBy?: string;
  expectedCash?: number; actualCash?: number; variance?: number; varianceReason?: string;
  reopenedAt?: string; reopenedBy?: string;
  drawer: Drawer;
};
export type ShiftsData = { drawerLimit: number; exchangeRate: number; shifts: ShiftView[] };

export const emptyCount = (): CashCount => ({
  denoms: CASH_DENOMS.map((d) => ({ denom: d, count: 0 })),
  coins: 0,
  riel: RIEL_DENOMS.map((d) => ({ denom: d, count: 0 })),
});

export const khr = (n: number) => `${n.toLocaleString("en-US")}៛`; // riel symbol ៛

// A quick denomination counter — USD notes + loose coins on the left, Khmer riel
// notes on the right (the store takes both). The live total is in USD, with
// riel converted at the store rate.
export function DenomCounter({ value, onChange, rate }: { value: CashCount; onChange: (c: CashCount) => void; rate: number }) {
  const total = countTotal(value, rate);
  const setUsd = (denom: number, count: number) =>
    onChange({ ...value, denoms: value.denoms.map((d) => (d.denom === denom ? { ...d, count: Math.max(0, Math.floor(count) || 0) } : d)) });
  const setRiel = (denom: number, count: number) =>
    onChange({ ...value, riel: (value.riel || []).map((d) => (d.denom === denom ? { ...d, count: Math.max(0, Math.floor(count) || 0) } : d)) });
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {/* USD */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">US Dollars</p>
          {value.denoms.map((d) => (
            <div key={d.denom} className="flex items-center gap-2">
              <span className="w-10 text-sm font-semibold text-slate-500">${d.denom}</span>
              <span className="text-slate-400">×</span>
              <input type="number" min={0} value={d.count || ""} onChange={(e) => setUsd(d.denom, Number(e.target.value))}
                className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm outline-none focus:border-brand-400" />
              <span className="ml-auto text-xs font-semibold tabular-nums text-ink-800">{usd(d.denom * d.count)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-10 text-sm font-semibold text-slate-500">Coins</span>
            <span className="text-slate-400">$</span>
            <input type="number" min={0} step="0.01" value={value.coins || ""} onChange={(e) => onChange({ ...value, coins: Math.max(0, Number(e.target.value) || 0) })}
              className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm outline-none focus:border-brand-400" />
            <span className="ml-auto text-xs font-semibold tabular-nums text-ink-800">{usd(value.coins || 0)}</span>
          </div>
        </div>
        {/* Riel */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Khmer Riel (÷ {rate.toLocaleString()})</p>
          {(value.riel || []).map((d) => (
            <div key={d.denom} className="flex items-center gap-2">
              <span className="w-16 text-[13px] font-semibold text-slate-500">{khr(d.denom)}</span>
              <span className="text-slate-400">×</span>
              <input type="number" min={0} value={d.count || ""} onChange={(e) => setRiel(d.denom, Number(e.target.value))}
                className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm outline-none focus:border-brand-400" />
              <span className="ml-auto text-xs font-semibold tabular-nums text-ink-800">{usd((d.denom * d.count) / (rate || 4100))}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-200 pt-2">
        <span className="text-sm font-bold uppercase tracking-wide text-slate-500">Counted total (USD)</span>
        <span className="text-lg font-extrabold tabular-nums text-brand-600">{usd(total)}</span>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: "open" | "pending_close" | "closed" }) {
  if (status === "open") return <Badge tone="emerald">Open</Badge>;
  if (status === "pending_close") return <Badge tone="amber">Pending close</Badge>;
  return <Badge tone="slate">Locked</Badge>;
}
export function VarianceTag({ v }: { v: number }) {
  if (v === 0) return <span className="font-semibold text-emerald-600">$0.00</span>;
  return <span className={`font-bold tabular-nums ${v < 0 ? "text-rose-600" : "text-amber-600"}`}>{v > 0 ? "+" : ""}{usd(v)}</span>;
}
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-ink-800">{value}</span>
    </div>
  );
}

// The live shift summary — the "shift survey" the cashier reads at a glance:
// where the drawer stands right now (opening float, what's sold, cash movements
// and the expected cash to count). The action buttons underneath run the drawer.
export function DrawerView({ shift, drawerLimit, onMovement, onClose }: {
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

export function MovementModal({ type, onClose, onSubmit, drawer, drawerLimit }: {
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

export function CloseModal({ shift, rate, onClose, onDone }: { shift: ShiftView; rate: number; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState<CashCount>(emptyCount());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = shift.drawer.expected;
  const actual = countTotal(count, rate);
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
          <DenomCounter value={count} onChange={setCount} rate={rate} />
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
