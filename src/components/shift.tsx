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
  Printer,
} from "lucide-react";
import { api, useFetch } from "@/lib/client";
import { Badge, StatCard, Modal } from "@/components/ui";
import { Select } from "@/components/Select";
import { usd, timeOnly } from "@/lib/format";
import { CASH_DENOMS, RIEL_DENOMS, countTotal } from "@/lib/money";
import type { CashCount, CashMovementType } from "@/lib/types";

export type Drawer = {
  opening: number; cashSales: number; cashIn: number; cashOut: number; drop: number; refunds: number;
  refundedCancelled: number; expected: number;
  sales: { total: number; cash: number; card: number; ewallet: number };
  riel: { cashIn: number; cashOut: number; drop: number; refunds: number };
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
  // Shift survey — count the drawer to check it matches, WITHOUT closing.
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
        <StatCard label="Cash In" value={`+${usd(d.cashIn)}`} sub={d.riel.cashIn > 0 ? `incl. ${khr(d.riel.cashIn)}` : undefined} accent="emerald" />
        <StatCard label="Cash Out" value={`-${usd(d.cashOut)}`} sub={d.riel.cashOut > 0 ? `incl. ${khr(d.riel.cashOut)}` : undefined} accent="amber" />
        <StatCard label="Safe Drops" value={`-${usd(d.drop + d.refunds)}`} sub={d.riel.drop + d.riel.refunds > 0 ? `incl. ${khr(d.riel.drop + d.riel.refunds)}` : undefined} accent="amber" />
        <StatCard label="Expected Drawer" value={usd(d.expected)} accent={over ? "rose" : "emerald"} />
      </div>

      {/* Refunds are NOT a button: cash goes back when an invoice is CANCELLED
          (Invoices → Cancel), and the drawer deducts it by itself. This line
          just shows how much went back, so nobody records it twice. */}
      {d.refundedCancelled > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
          <RotateCcw size={15} className="mt-0.5 shrink-0 text-slate-400" />
          <span><b>{usd(d.refundedCancelled)}</b> handed back for cancelled invoices this shift — already deducted from the expected drawer automatically.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => onMovement("CASH_IN")}><PlusCircle size={16} /> Cash In</button>
        <button className="btn-ghost" onClick={() => onMovement("CASH_OUT")}><MinusCircle size={16} /> Cash Out</button>
        <button className="btn-ghost" onClick={() => onMovement("DROP")}><Vault size={16} /> Safe Drop</button>
        <button className="btn-ghost ml-auto ring-1 ring-brand-200 text-brand-700" onClick={() => setSurvey(true)}><Scale size={16} /> Shift survey</button>
        <button className="btn-primary" onClick={onClose}><Lock size={16} /> Close shift &amp; count</button>
      </div>

      {survey && <SurveyModal shift={shift} rate={rate} onClose={() => setSurvey(false)} />}
    </div>
  );
}

// A printed shift-survey slip — a thermal-receipt style record of the money
// check. Opens a print window and fires the browser print dialog, the same way
// invoices print. Dollars and riel are listed separately, note by note.
function printSurveySlip(survey: any, business: any) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const money = (n: number) => `$${(Math.round((n || 0) * 100) / 100).toFixed(2)}`;
  const riel = (n: number) => `${(n || 0).toLocaleString("en-US")}៛`;
  const b = business || {};
  const contact = [b.address, b.phone].filter(Boolean).join(" · ");
  const dt = new Date(survey.at);
  const when = dt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const c = survey.count || {};
  const usdLines = (c.denoms || []).filter((x: any) => x.count > 0).map((x: any) => `<div class="ln"><span>$${x.denom} × ${x.count}</span><span>${money(x.denom * x.count)}</span></div>`).join("");
  const coinLine = c.coins > 0 ? `<div class="ln"><span>Coins</span><span>${money(c.coins)}</span></div>` : "";
  const rielLines = (c.riel || []).filter((x: any) => x.count > 0).map((x: any) => `<div class="ln"><span>${riel(x.denom)} × ${x.count}</span><span>${riel(x.denom * x.count)}</span></div>`).join("");
  const v = survey.variance || 0;
  const verdict = v === 0 ? "MONEY MATCHES" : v < 0 ? `SHORT ${money(Math.abs(v))}` : `OVER ${money(v)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(survey.id)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Courier New", ui-monospace, monospace; width: 300px; margin: 0 auto; padding: 14px 16px; color: #000; font-size: 12px; }
  .ctr { text-align: center; }
  .name { font-weight: 800; font-size: 15px; }
  .sub { color: #444; font-size: 11px; }
  .title { font-weight: 800; letter-spacing: 2px; margin-top: 6px; }
  hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
  .ln { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .ln span:last-child { font-weight: 700; white-space: nowrap; }
  .sec { font-weight: 800; font-size: 10px; letter-spacing: 1px; margin-bottom: 2px; }
  .big { font-size: 14px; font-weight: 800; }
  .verdict { text-align: center; font-weight: 800; letter-spacing: 1px; padding: 6px; margin-top: 6px; border: 2px solid #000; }
  .sig { margin-top: 10px; }
  .sig .row { margin-top: 14px; border-top: 1px solid #000; padding-top: 2px; font-size: 10px; color: #333; }
  @media print { body { width: auto; } }
</style></head><body>
  <div class="ctr">
    <div class="name">${esc(b.name || "Store")}</div>
    ${contact ? `<div class="sub">${esc(contact)}</div>` : ""}
    <div class="title">SHIFT SURVEY</div>
    <div class="sub">${esc(survey.id)}</div>
  </div>
  <hr>
  <div class="ln"><span>Date</span><span>${esc(when)}</span></div>
  <div class="ln"><span>Shift</span><span>${esc(survey.shift)} · ${esc(survey.posTerminalId)}</span></div>
  <div class="ln"><span>Surveyed by</span><span>${esc(survey.by)}</span></div>
  <hr>
  <div class="sec">SOLD THIS SHIFT</div>
  <div class="ln"><span>Total sales</span><span>${money(survey.sales.total)}</span></div>
  <div class="ln"><span>Cash</span><span>${money(survey.sales.cash)}</span></div>
  <div class="ln"><span>Card</span><span>${money(survey.sales.card)}</span></div>
  <div class="ln"><span>E-wallet</span><span>${money(survey.sales.ewallet)}</span></div>
  <hr>
  <div class="sec">DRAWER COUNTED</div>
  ${usdLines || `<div class="ln"><span>No dollar notes</span><span>${money(0)}</span></div>`}
  ${coinLine}
  <div class="ln"><span><b>Dollars counted</b></span><span>${money(survey.countedUsd)}</span></div>
  <hr>
  ${rielLines || `<div class="ln"><span>No riel notes</span><span>${riel(0)}</span></div>`}
  <div class="ln"><span><b>Riel counted</b></span><span>${riel(survey.countedRiel)}</span></div>
  <hr>
  <div class="ln"><span>Expected cash</span><span>${money(survey.expected)}</span></div>
  <div class="ln big"><span>Counted (USD)</span><span>${money(survey.counted)}</span></div>
  <div class="ln big"><span>Variance</span><span>${v > 0 ? "+" : ""}${money(v)}</span></div>
  <div class="verdict">${esc(verdict)}</div>
  ${survey.note ? `<hr><div class="sub">Note: ${esc(survey.note)}</div>` : ""}
  <div class="sig">
    <div class="row">Counted by</div>
    <div class="row">Verified by (supervisor)</div>
  </div>
  <hr>
  <div class="ctr sub">This is a money-check record. The shift is not closed.</div>
</body></html>`;
  const w = window.open("", "SURVEY", "width=380,height=640");
  if (!w) { alert("Allow pop-ups to print the survey slip."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the layout a tick, then print.
  setTimeout(() => { try { w.print(); } catch {} }, 250);
}

// Shift survey — a mid-shift CHECK, not a close. The operations team counts the
// drawer whenever they want to verify the till: it shows what sold, the cash the
// drawer should hold, what was actually counted, and a plain verdict — does the
// money MATCH or not? Counting here changes nothing and never ends the shift.
// Saving records the survey and PRINTS a slip that captures everything.
export function SurveyModal({ shift, rate, onClose }: { shift: ShiftView; rate: number; onClose: () => void }) {
  const [count, setCount] = useState<CashCount>(emptyCount());
  const { data: business } = useFetch<any>("/api/business");
  const [busy, setBusy] = useState(false);
  const d = shift.drawer;
  const expected = d.expected;
  const counted = countTotal(count, rate);
  const variance = Math.round((counted - expected) * 100) / 100;
  const matched = variance === 0;

  async function saveAndPrint() {
    setBusy(true);
    try {
      const survey = await api("/api/shift-surveys", { method: "POST", body: JSON.stringify({ shiftId: shift.id, count }) });
      // Close the survey first, then print — the print dialog blocks the thread,
      // so closing beforehand keeps the till clean behind the slip.
      onClose();
      printSurveySlip(survey, business);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="2xl" title={`Shift Survey · Shift ${shift.shift} · ${shift.posTerminalId}`} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || counted <= 0} onClick={saveAndPrint}>
          <Printer size={16} /> {busy ? "Saving…" : "Save & print survey"}
        </button>
      </div>
    }>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <DenomCounter value={count} onChange={setCount} rate={rate} />
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
          <p className="text-xs text-slate-400">Saving records this survey and prints a slip with everything — the shift stays open.</p>
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

// Preset reasons per movement type — a dropdown, not free text, so the reason
// is always one of a known set (and reports can group by it). "Other" reveals a
// box for anything not listed.
const MV_REASONS: Record<CashMovementType, string[]> = {
  CASH_IN: ["Change fund top-up", "Returned petty cash", "Cash correction", "Other"],
  CASH_OUT: ["Supplier / delivery payment", "Store supplies", "Petty cash", "Utility / bill payment", "Other"],
  DROP: ["Over cash limit", "Scheduled safe drop", "End-of-shift drop", "Other"],
  REFUND: ["Customer refund", "Wrong charge", "Damaged / returned product", "Other"],
};

const VARIANCE_REASONS = [
  "Wrong change given",
  "Miscount",
  "Unrecorded cash sale",
  "Cash paid out not recorded",
  "Suspected theft / loss",
  "Other",
];

// A required reason picker: a dropdown of preset reasons; picking "Other" shows
// a text box. `value` is the effective reason, "" until a valid choice is made.
function ReasonSelect({ label, options, sel, onSel, other, onOther }: {
  label: string; options: string[]; sel: string; onSel: (v: string) => void; other: string; onOther: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <Select value={sel} onChange={onSel} placeholder="Select a reason…" options={options.map((r) => ({ value: r, label: r }))} />
      {sel === "Other" && (
        <input value={other} onChange={(e) => onOther(e.target.value)} placeholder="Type the reason" className="input mt-2" autoFocus />
      )}
    </div>
  );
}

// Safe Drop report — how much this shift has moved to the safe, with DOLLARS and
// RIEL kept SEPARATE (never merged into one figure), plus a line-by-line list so
// the safe can be counted note-for-note in each currency. Shown right beside the
// drop form so the cashier sees the running total as they drop.
export function SafeDropReport({ shiftId }: { shiftId: string }) {
  const { data, loading } = useFetch<any>(`/api/cash-report?shiftId=${shiftId}`);
  const t = data?.dropTotals;
  const drops: any[] = data?.drops ?? [];
  const count = t?.count ?? 0;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
          <Vault size={13} /> Dropped this shift
        </p>
        {/* Dollars and riel side by side — separate, never combined. */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-brand-50 px-3 py-2.5 ring-1 ring-brand-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-brand-500">In Dollars</p>
            <p className="text-lg font-extrabold tabular-nums text-brand-700">{usd(t?.usd ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-violet-50 px-3 py-2.5 ring-1 ring-violet-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-500">In Riel</p>
            <p className="text-lg font-extrabold tabular-nums text-violet-700">{khr(t?.riel ?? 0)}</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-slate-200 pt-2.5 text-xs">
          <span className="text-slate-500">{count} drop{count === 1 ? "" : "s"} · USD equivalent</span>
          <span className="font-bold tabular-nums text-ink-800">{usd(t?.usdEquivalent ?? 0)}</span>
        </div>
      </div>
      {loading && !data ? (
        <p className="px-1 py-2 text-sm text-slate-400">Loading…</p>
      ) : drops.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400">No safe drops yet this shift.</p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
          {drops.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="w-12 shrink-0 text-xs font-semibold text-slate-400">{timeOnly(d.at)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{d.reason || "Safe drop"}</span>
              <span className="w-16 shrink-0 text-right font-bold tabular-nums text-brand-700">{d.usd > 0 ? usd(d.usd) : "—"}</span>
              <span className="w-20 shrink-0 text-right font-bold tabular-nums text-violet-700">{d.riel > 0 ? khr(d.riel) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MovementModal({ type, onClose, onSubmit, drawer, drawerLimit, rate, shift }: {
  type: CashMovementType; onClose: () => void;
  onSubmit: (p: { amountUsd: number; amountRiel: number; reason: string; notes?: string }) => Promise<void>;
  drawer: Drawer; drawerLimit: number; rate: number; shift?: ShiftView;
}) {
  const meta = MV_META[type];
  const recDrop = type === "DROP" && drawerLimit > 0 ? Math.max(0, Math.round((drawer.expected - drawerLimit) * 100) / 100) : 0;
  // Two separate amounts — dollars and riel — kept apart so the record keeps a
  // total in each currency (not one merged, converted number).
  const [usdAmount, setUsdAmount] = useState(recDrop > 0 ? String(recDrop) : "");
  const [rielAmount, setRielAmount] = useState("");
  const [reasonSel, setReasonSel] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const reason = reasonSel === "Other" ? reasonOther.trim() : reasonSel;
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const amountUsd = Math.round((Number(usdAmount) || 0) * 100) / 100;
  const amountRiel = Math.max(0, Math.floor(Number(rielAmount) || 0));
  const totalUsd = Math.round((amountUsd + amountRiel / (rate || 4100)) * 100) / 100;

  const addUsd = (v: number) => setUsdAmount(String(Math.round(((Number(usdAmount) || 0) + v) * 100) / 100));
  const addRiel = (v: number) => setRielAmount(String((Math.floor(Number(rielAmount) || 0)) + v));

  async function go() {
    setBusy(true);
    try { await onSubmit({ amountUsd, amountRiel, reason, notes: notes.trim() || undefined }); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  const chip = "rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 active:scale-[0.97]";

  // On a Safe Drop, show the running Safe Drop report beside the form.
  const showReport = type === "DROP" && !!shift;

  const form = (
    <>
      <p className="mb-3 text-sm text-slate-500">{meta.hint}</p>
      {type === "DROP" && recDrop > 0 && (
        <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">Recommended drop to reach the {usd(drawerLimit)} limit: {usd(recDrop)}</p>
      )}
      {/* Dollars and riel are entered — and kept — separately. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Amount in dollars ($)</label>
          <div className="mb-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => addUsd(100)} className={chip}>+ $100</button>
            <button type="button" onClick={() => addUsd(50)} className={chip}>+ $50</button>
            <button type="button" onClick={() => setUsdAmount("")} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">Clear</button>
          </div>
          <input type="number" min={0} step="0.01" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} placeholder="0.00" className="input" autoFocus />
        </div>
        <div>
          <label className="label">Amount in riel (៛)</label>
          <div className="mb-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => addRiel(100000)} className={chip}>+ {khr(100000)}</button>
            <button type="button" onClick={() => addRiel(50000)} className={chip}>+ {khr(50000)}</button>
            <button type="button" onClick={() => setRielAmount("")} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">Clear</button>
          </div>
          <input type="number" min={0} step="1" value={rielAmount} onChange={(e) => setRielAmount(e.target.value)} placeholder="0" className="input" />
        </div>
      </div>
      {/* The two currencies and the combined USD the drawer will use. */}
      <div className="mb-3 mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm ring-1 ring-slate-200">
        <span className="font-semibold text-slate-500">Total</span>
        <span className="font-bold text-ink-800">
          {usd(amountUsd)}{amountRiel > 0 && <span className="text-slate-500"> + {khr(amountRiel)}</span>}
          <span className="ml-1.5 text-slate-400">= {usd(totalUsd)}</span>
        </span>
      </div>
      <div className="mb-3">
        <ReasonSelect label="Reason" options={MV_REASONS[type]} sel={reasonSel} onSel={setReasonSel} other={reasonOther} onOther={setReasonOther} />
      </div>
      <label className="label">Notes (optional)</label>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
    </>
  );

  return (
    <Modal open onClose={onClose} size={showReport ? "2xl" : "lg"} title={meta.title} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || totalUsd <= 0 || !reason} onClick={go}>{busy ? "Saving…" : `Record ${usd(totalUsd)}`}</button>
      </div>
    }>
      {showReport ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div>{form}</div>
          <div className="lg:sticky lg:top-0 lg:self-start"><SafeDropReport shiftId={shift!.id} /></div>
        </div>
      ) : form}
    </Modal>
  );
}

export function CloseModal({ shift, rate, onClose, onDone }: { shift: ShiftView; rate: number; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState<CashCount>(emptyCount());
  const [reasonSel, setReasonSel] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const reason = reasonSel === "Other" ? reasonOther.trim() : reasonSel;
  const [busy, setBusy] = useState(false);
  const expected = shift.drawer.expected;
  const actual = countTotal(count, rate);
  const variance = Math.round((actual - expected) * 100) / 100;

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/shifts/${shift.id}/close`, { method: "POST", body: JSON.stringify({ closingCount: count, varianceReason: reason }) });
      onDone();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="2xl" title={`Close Shift ${shift.shift} · ${shift.posTerminalId}`} footer={
      <div className="flex w-full justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || (variance !== 0 && !reason)} onClick={submit}>
          <ClipboardCheck size={16} /> {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    }>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <DenomCounter value={count} onChange={setCount} rate={rate} />
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
            <ReasonSelect label="Variance reason (required)" options={VARIANCE_REASONS} sel={reasonSel} onSel={setReasonSel} other={reasonOther} onOther={setReasonOther} />
          )}
          <p className="text-xs text-slate-400">Submitting sends the count to a supervisor. Once approved, the shift locks and can&apos;t be edited.</p>
        </div>
      </div>
    </Modal>
  );
}
