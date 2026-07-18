"use client";

// The cash shift, run from inside the till.
//
// The cashier never has to leave the sale screen to see where the drawer stands
// or to close out: this modal shows the live SHIFT SUMMARY (opening float, cash
// sales, cash in/out, expected drawer) and runs the CLOSE-AND-COUNT flow, using
// exactly the same drawer engine as the Money Management page.

import { useState } from "react";
import { Wallet, Unlock, ClipboardCheck } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { Modal, Card, Spinner, ErrorBox, Badge, StatCard } from "@/components/ui";
import { usd } from "@/lib/format";
import { countTotal } from "@/lib/money";
import type { CashCount, CashMovementType } from "@/lib/types";
import {
  DenomCounter,
  DrawerView,
  MovementModal,
  CloseModal,
  emptyCount,
  type ShiftsData,
} from "@/components/shift";

export function PosShiftModal({ terminal, onClose }: { terminal: string; onClose: () => void }) {
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
  async function submitMovement(payload: { amount: number; reason: string; notes?: string }) {
    if (!current) return;
    await api("/api/cash-movements", { method: "POST", body: JSON.stringify({ shiftId: current.id, type: mv, ...payload }) });
    setMv(null);
    reload();
  }

  const [closing, setClosing] = useState(false);

  return (
    <>
      <Modal open onClose={onClose} size="lg" title={`Cash Shift · ${terminal}`} footer={
        <div className="flex w-full justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      }>
        {error && <ErrorBox message={error} />}
        {loading && !data ? (
          <Spinner label="Loading shift…" />
        ) : current ? (
          // Live shift: summary + drawer actions + close & count.
          <DrawerView shift={current} drawerLimit={drawerLimit} onMovement={setMv} onClose={() => setClosing(true)} />
        ) : pending ? (
          // Already counted and submitted — waiting on a supervisor to approve.
          <div className="space-y-4">
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
          <Card title={`Open a shift on ${terminal}`} subtitle="Count the opening float by denomination, then open the shift." icon={<Wallet size={15} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Shift</label>
                <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-1">
                  {(["A", "B", "C"] as const).map((s) => (
                    <button key={s} onClick={() => setOpenShiftName(s)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${openShiftName === s ? "bg-white text-ink-900 shadow-sm" : "text-slate-500"}`}>Shift {s}</button>
                  ))}
                </div>
                <button className="btn-primary w-full" disabled={busy || countTotal(openCount, rate) <= 0} onClick={openShift}>
                  <Unlock size={16} /> {busy ? "Opening…" : `Open shift · float ${usd(countTotal(openCount, rate))}`}
                </button>
                <p className="mt-2 text-xs text-slate-400">Sales made on this till attribute to this shift once it&apos;s open.</p>
              </div>
              <DenomCounter value={openCount} onChange={setOpenCount} rate={rate} />
            </div>
          </Card>
        )}
      </Modal>

      {mv && current && <MovementModal type={mv} onClose={() => setMv(null)} onSubmit={submitMovement} drawer={current.drawer} drawerLimit={drawerLimit} />}
      {closing && current && (
        <CloseModal
          shift={current}
          rate={rate}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); reload(); }}
        />
      )}
    </>
  );
}
