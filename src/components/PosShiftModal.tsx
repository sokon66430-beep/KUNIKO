"use client";

// The cash shift, run from inside the till — as a full-screen page so the
// drawer count has room to breathe.
//
// The cashier never has to leave the sale screen to see where the drawer stands
// or to close out: this shows the live SHIFT SUMMARY (opening float, cash sales,
// cash in/out, expected drawer) and runs the CLOSE-AND-COUNT flow, using exactly
// the same drawer engine as the Money Management page.

import { useEffect, useRef, useState } from "react";
import { Wallet, Unlock, X } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { Spinner, ErrorBox, Badge, StatCard } from "@/components/ui";
import { usd } from "@/lib/format";
import { countTotal } from "@/lib/money";
import type { CashCount, CashMovementType } from "@/lib/types";
import {
  DenomCounter,
  DrawerView,
  MovementModal,
  CloseModal,
  SurveyModal,
  emptyCount,
  type ShiftsData,
} from "@/components/shift";

// Optionally jump straight to a shift action when opened (from a POS quick
// button) instead of landing on the drawer overview.
export type ShiftAction = "DROP" | "survey" | "close";

export function PosShiftModal({ terminal, initialAction, onClose }: { terminal: string; initialAction?: ShiftAction; onClose: () => void }) {
  const { data, loading, error, reload } = useFetch<ShiftsData>("/api/shifts");
  const shifts = data?.shifts ?? [];
  const drawerLimit = data?.drawerLimit ?? 0;
  const rate = data?.exchangeRate ?? 4100;
  const current = shifts.find((s) => s.posTerminalId === terminal && s.status === "open");
  const pending = shifts.find((s) => s.posTerminalId === terminal && s.status === "pending_close");

  // Open-shift form (shown only when this till has no open shift)
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

  const [mv, setMv] = useState<CashMovementType | null>(null);
  async function submitMovement(payload: { amountUsd: number; amountRiel: number; reason: string; notes?: string }) {
    if (!current) return;
    const created = await api("/api/cash-movements", { method: "POST", body: JSON.stringify({ shiftId: current.id, type: mv, ...payload }) });
    setMv(null);
    reload();
    return created;
  }

  const [closing, setClosing] = useState(false);
  const [survey, setSurvey] = useState(false);

  // If opened for a specific action, jump straight to it once the open shift is
  // known. No open shift → the open-shift form shows instead (which is correct).
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || !initialAction || !current) return;
    fired.current = true;
    if (initialAction === "DROP") setMv("DROP");
    else if (initialAction === "survey") setSurvey(true);
    else if (initialAction === "close") setClosing(true);
  }, [initialAction, current]);

  return (
    <>
      {/* Full-screen page over the till. */}
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><Wallet size={18} /></span>
            <div>
              <h2 className="text-base font-bold leading-tight text-ink-900">Cash Shift</h2>
              <p className="text-xs text-slate-500">Drawer control · {terminal}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} /> Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <div className="mx-auto max-w-4xl">
            {error && <ErrorBox message={error} />}
            {loading && !data ? (
              <Spinner label="Loading shift…" />
            ) : current ? (
              // Live shift: summary + drawer actions + close & count.
              <DrawerView shift={current} drawerLimit={drawerLimit} rate={rate} onMovement={setMv} onClose={() => setClosing(true)} />
            ) : pending ? (
              // Already counted and submitted — waiting on a supervisor to approve.
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <Badge tone="amber">Pending close</Badge>
                  <span className="text-sm text-slate-500">Shift {pending.shift} · {pending.cashier} — submitted, waiting for supervisor approval.</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard label="Expected" value={usd(pending.expectedCash ?? pending.drawer.expected)} accent="violet" />
                  <StatCard label="Counted" value={usd(pending.actualCash ?? 0)} accent="brand" />
                  <StatCard
                    label="Variance"
                    value={usd(pending.variance ?? 0)}
                    accent={(pending.variance ?? 0) < 0 ? "rose" : "emerald"}
                  />
                </div>
                <p className="text-xs text-slate-400">A supervisor approves and locks this shift from Money Management. You can open the next shift once it&apos;s approved.</p>
              </div>
            ) : (
              // No shift on this till yet — open one right here.
              <div>
                <div className="mb-5">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-ink-900">
                    <Wallet size={18} className="text-brand-600" /> Open a shift on {terminal}
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500">Count the opening float by denomination, then open the shift.</p>
                </div>
                <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
                  <div className="space-y-4">
                    <div>
                      <label className="label">Shift</label>
                      <div className="inline-flex rounded-xl bg-slate-100 p-1">
                        {(["A", "B", "C"] as const).map((s) => (
                          <button key={s} onClick={() => setOpenShiftName(s)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${openShiftName === s ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Shift {s}</button>
                        ))}
                      </div>
                    </div>
                    <button className="btn-primary w-full py-3 text-base" disabled={busy || countTotal(openCount, rate) <= 0} onClick={openShift}>
                      <Unlock size={17} /> {busy ? "Opening…" : `Open shift · float ${usd(countTotal(openCount, rate))}`}
                    </button>
                    <p className="text-xs text-slate-400">Sales made on this till attribute to this shift once it&apos;s open.</p>
                  </div>
                  <DenomCounter value={openCount} onChange={setOpenCount} rate={rate} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {mv && current && <MovementModal type={mv} onClose={() => setMv(null)} onSubmit={submitMovement} drawer={current.drawer} drawerLimit={drawerLimit} rate={rate} shift={current} />}
      {closing && current && (
        <CloseModal
          shift={current}
          rate={rate}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); reload(); }}
        />
      )}
      {survey && current && <SurveyModal shift={current} rate={rate} onClose={() => setSurvey(false)} />}
    </>
  );
}
