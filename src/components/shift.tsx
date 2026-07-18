"use client";

// Shared shift / cash-drawer building blocks.
//
// These used to live inside the Money Management page. They now live here so the
// POS till can show the SAME drawer summary and run the SAME close-and-count
// flow without the cashier leaving the sale screen — one source of truth, so the
// till and the money page can never drift apart on how the drawer is counted or
// what "expected" means.

import { useState, type ReactNode } from "react";
import {
  PlusCircle,
  MinusCircle,
  Vault,
  RotateCcw,
  Lock,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Scale,
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

// One row of the counter: a denomination label, a "× count" input, and the USD
// value it comes to. Shared by both currency panels so every row lines up.
function CountRow({ label, labelWidth, count, onCount, value }: {
  label: string; labelWidth: string; count: number; onCount: (n: number) => void; value: number;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={`${labelWidth} shrink-0 text-sm font-semibold text-slate-500`}>{label}</span>
      <span className="text-slate-300">×</span>
      <input
        type="number"
        min={0}
        value={count || ""}
        onChange={(e) => onCount(Number(e.target.value))}
        placeholder="0"
        className="h-10 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-semibold outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />
      <span className="ml-auto w-20 text-right text-sm font-bold tabular-nums text-ink-800">{usd(value)}</span>
    </div>
  );
}

function CurrencyPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// The denomination counter — US Dollars and Khmer riel in two clean, self-
// contained panels (each row aligned: note · × count · USD value). The live
// grand total is in USD, riel converted at the store rate.
export function DenomCounter({ value, onChange, rate }: { value: CashCount; onChange: (c: CashCount) => void; rate: number }) {
  const total = countTotal(value, rate);
  const setUsd = (denom: number, count: number) =>
    onChange({ ...value, denoms: value.denoms.map((d) => (d.denom === denom ? { ...d, count: Math.max(0, Math.floor(count) || 0) } : d)) });
  const setRiel = (denom: number, count: number) =>
    onChange({ ...value, riel: (value.riel || []).map((d) => (d.denom === denom ? { ...d, count: Math.max(0, Math.floor(count) || 0) } : d)) });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CurrencyPanel title="US Dollars">
          {value.denoms.map((d) => (
            <CountRow key={d.denom} label={`$${d.denom}`} labelWidth="w-16" count={d.count} onCount={(n) => setUsd(d.denom, n)} value={d.denom * d.count} />
          ))}
        </CurrencyPanel>
        <CurrencyPanel title={`Khmer Riel · ÷ ${rate.toLocaleString()}`}>
          {(value.riel || []).map((d) => (
            <CountRow key={d.denom} label={khr(d.denom)} labelWidth="w-20" count={d.count} onCount={(n) => setRiel(d.denom, n)} value={(d.denom * d.count) / (rate || 4100)} />
          ))}
        </CurrencyPanel>
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-brand-50 px-5 py-3.5 ring-1 ring-brand-100">
        <span className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">Counted total (USD)</span>
        <span className="text-2xl font-extrabold tabular-nums text-brand-600">{usd(total)}</span>
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
export function DrawerView({ shift, drawerLimit, rate, onMovement, onClose }: {
  shift: ShiftView; drawerLimit: number; rate: number; onMovement: (t: CashMovementType) => void; onClose: () => void;
}) {
  const d = shift.drawer;
  const over = drawerLimit > 0 && d.expected > drawerLimit;
  const recDrop = over ? Math.max(0, Math.round((d.expected - drawerLimit) * 100) / 100) : 0;
  // Money survey — count the drawer to check it matches, WITHOUT closing.
  const [survey, setSurvey] = useState(false);
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
        <button className="btn-ghost ml-auto ring-1 ring-brand-200 text-brand-700" onClick={() => setSurvey(true)}><Scale size={16} /> Money survey</button>
        <button className="btn-primary" onClick={onClose}><Lock size={16} /> Close shift &amp; count</button>
      </div>

      {survey && <SurveyModal shift={shift} rate={rate} onClose={() => setSurvey(false)} />}
    </div>
  );
}

// Money survey — a mid-shift CHECK, not a close. The operations team counts the
// drawer whenever they want to verify the till: it shows what sold, the cash the
// drawer should hold, what was actually counted, and a plain verdict — does the
// money MATCH or not? Counting here changes nothing and never ends the shift.
export function SurveyModal({ shift, rate, onClose }: { shift: ShiftView; rate: number; onClose: () => void }) {
  const [count, setCount] = useState<CashCount>(emptyCount());
  const d = shift.drawer;
  const expected = d.expected;
  const counted = countTotal(count, rate);
  const variance = Math.round((counted - expected) * 100) / 100;
  const matched = variance === 0;

  return (
    <Modal open onClose={onClose} size="2xl" title={`Money Survey · Shift ${shift.shift} · ${shift.posTerminalId}`} footer={
      <div className="flex w-full justify-end">
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    }>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <p className="label">Count the drawer to check</p>
          <DenomCounter value={count} onChange={setCount} rate={rate} />
        </div>
        <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          {/* How much was sold this shift — the "how much they can sell" side. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Sold this shift</p>
            <Row label="Total sales" value={usd(d.sales.total)} />
            <Row label="Cash" value={usd(d.sales.cash)} />
            <Row label="Card" value={usd(d.sales.card)} />
            <Row label="E-wallet" value={usd(d.sales.ewallet)} />
          </div>
          {/* Expected vs counted — the "does the money match" side. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <Row label="Expected cash" value={usd(expected)} />
            <Row label="Counted cash" value={usd(counted)} />
          </div>
          {/* Plain verdict. */}
          {matched ? (
            <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3.5 font-bold text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle2 size={18} /> Money matches
            </div>
          ) : (
            <div className={`rounded-2xl px-4 py-3.5 font-bold ring-1 ${variance < 0 ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
              <div className="flex items-center gap-2"><AlertTriangle size={18} /> {variance < 0 ? "Short" : "Over"} by {usd(Math.abs(variance))}</div>
              <p className="mt-1 text-xs font-medium opacity-80">
                {variance < 0 ? "Less cash in the drawer than the sales say there should be." : "More cash in the drawer than the sales say there should be."}
              </p>
            </div>
          )}
          <p className="text-xs text-slate-400">This is a check only — it doesn&apos;t record anything or close the shift.</p>
        </div>
      </div>
    </Modal>
  );
}

const MV_META: Record<CashMovementType, { title: string; hint: string }> = {
  CASH_IN: { title: "Cash In", hint: "Change money, additional float, returned petty cash." },
  CASH_OUT: { title: "Cash Out", hint: "Store expense, emergency purchase, petty cash." },
  DROP: { title: "Safe Drop", hint: "Move excess cash from the drawer to the store safe." },
  REFUND: { title: "Cash Refund", hint: "Cash returned to a customer." },
};

export function MovementModal({ type, onClose, onSubmit, drawer, drawerLimit, rate }: {
  type: CashMovementType; onClose: () => void; onSubmit: (p: { amount: number; reason: string; notes?: string }) => Promise<void>;
  drawer: Drawer; drawerLimit: number; rate: number;
}) {
  const meta = MV_META[type];
  const recDrop = type === "DROP" && drawerLimit > 0 ? Math.max(0, Math.round((drawer.expected - drawerLimit) * 100) / 100) : 0;
  const [amount, setAmount] = useState(recDrop > 0 ? String(recDrop) : "");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = Math.round((Number(amount) || 0) * 100) / 100;

  // Tap-to-add note buttons — the amount is recorded in USD, so the riel notes
  // add their USD value at the store rate. Tap several times to stack notes.
  const QUICK = [
    { label: "$100", usd: 100 },
    { label: "$50", usd: 50 },
    { label: khr(100000), usd: 100000 / (rate || 4100) },
    { label: khr(50000), usd: 50000 / (rate || 4100) },
  ];
  const addQuick = (v: number) => setAmount(String(Math.round(((Number(amount) || 0) + v) * 100) / 100));

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
      {/* Quick notes — tap to add, so the operations team doesn't have to type. */}
      <div className="mb-2 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => addQuick(q.usd)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 active:scale-[0.97]"
          >
            + {q.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAmount("")}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          Clear
        </button>
      </div>
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
    <Modal open onClose={onClose} size="2xl" title={`Close Shift ${shift.shift} · ${shift.posTerminalId}`} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || (variance !== 0 && !reason.trim())} onClick={submit}>
          <ClipboardCheck size={16} /> {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    }>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div>
          <p className="label">Count the drawer</p>
          <DenomCounter value={count} onChange={setCount} rate={rate} />
        </div>
        <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <Row label="Expected cash" value={usd(expected)} />
            <Row label="Counted cash" value={usd(actual)} />
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-slate-200 pt-2.5">
              <span className="font-bold text-slate-600">Variance</span>
              <span className="text-base"><VarianceTag v={variance} /></span>
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
