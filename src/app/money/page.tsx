"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { Wallet, Unlock, Lock, ClipboardCheck, BarChart3, Vault, ChevronLeft } from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { useTillMode } from "@/lib/tillmode";
import { confirmDialog } from "@/components/confirm";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { usd, num, dateTime } from "@/lib/format";
import { countTotal } from "@/lib/money";
import { canApproveCash, canReopenShift } from "@/lib/access";
import { DatePicker } from "@/components/DatePicker";
import type { CashCount, CashMovementType } from "@/lib/types";
import {
  DenomCounter,
  DrawerView,
  MovementModal,
  CloseModal,
  StatusBadge,
  VarianceTag,
  emptyCount,
  type ShiftsData,
} from "@/components/shift";

const TERMINAL_KEY = "stookii_pos_terminal";

export default function MoneyPage() {
  const role = useRole();
  const { tillMode } = useTillMode();
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
  const rate = data?.exchangeRate ?? 4100;
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
  async function submitMovement(payload: { amountUsd: number; amountRiel: number; reason: string; notes?: string; reference?: string }) {
    if (!current) return;
    const created = await api("/api/cash-movements", { method: "POST", body: JSON.stringify({ shiftId: current.id, type: mv, ...payload }) });
    setMv(null);
    reload();
    return created;
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
      {/* On a locked till there's no sidebar, so give a clear way back to the POS. */}
      {tillMode && (
        <Link
          href="/pos"
          className="mb-3 inline-flex items-center gap-1 rounded-lg py-1.5 pl-1.5 pr-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-ink-900"
        >
          <ChevronLeft size={18} /> Point of Sale
        </Link>
      )}
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
            <DrawerView shift={current} drawerLimit={drawerLimit} rate={rate} onMovement={setMv} onClose={() => setClosing(true)} onChanged={reload} showActions={false} />
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
                  <button className="btn-primary w-full" disabled={busy || countTotal(openCount, rate) <= 0} onClick={openShift}>
                    <Unlock size={16} /> {busy ? "Opening…" : `Open shift · float ${usd(countTotal(openCount, rate))}`}
                  </button>
                  <p className="mt-2 text-xs text-slate-400">Sales made on this till attribute to this shift once it&apos;s open.</p>
                </div>
                <DenomCounter value={openCount} onChange={setOpenCount} rate={rate} />
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

      {mv && current && <MovementModal type={mv} onClose={() => setMv(null)} onSubmit={submitMovement} drawer={current.drawer} drawerLimit={drawerLimit} rate={rate} shift={current} />}
      {closing && current && <CloseModal shift={current} rate={rate} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload(); }} />}
    </div>
  );
}

function ReportTab() {
  const [date, setDate] = useState("");
  const url = useMemo(() => `/api/cash-report${date ? `?date=${date}` : ""}`, [date]);
  const { data, loading } = useFetch<any>(url);
  // A cash report for a future day makes no sense — cap the picker at today.
  const today = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-600">Day</label>
          <DatePicker value={date} onChange={setDate} max={today} allowClear />
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

          {/* Safe Drop report — what went to the safe, dollars and riel SEPARATE,
              so the safe can be counted note-for-note in each currency. */}
          <Card title="Safe Drop report" subtitle="Money moved to the store safe — dollars and riel counted separately" icon={<Vault size={15} />}>
            {(!data.drops || data.drops.length === 0) ? (
              <EmptyState title="No safe drops in range" hint="Record drops from the till's Cash Drawer." icon={<Vault size={18} />} />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Dropped in Dollars" value={usd(data.dropTotals.usd)} accent="brand" />
                  <StatCard label="Dropped in Riel" value={`${data.dropTotals.riel.toLocaleString()}៛`} accent="violet" />
                  <StatCard label="Total (USD equivalent)" value={usd(data.dropTotals.usdEquivalent)} accent="emerald" />
                  <StatCard label="Drops" value={num(data.dropTotals.count)} accent="violet" />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <Th>When</Th><Th>Terminal</Th><Th>Shift</Th><Th>By</Th><Th>Reason</Th><Th align="right">Dollars</Th><Th align="right">Riel</Th><Th align="right">= USD</Th>
                    </THead>
                    <TBody>
                      {data.drops.map((d: any) => (
                        <Tr key={d.id}>
                          <Td className="whitespace-nowrap text-slate-500">{dateTime(d.at)}</Td>
                          <Td>{d.posTerminalId}</Td>
                          <Td>Shift {d.shift}</Td>
                          <Td>{d.by}</Td>
                          <Td className="text-slate-500">{d.reason}</Td>
                          <Td align="right">{d.usd > 0 ? usd(d.usd) : "—"}</Td>
                          <Td align="right">{d.riel > 0 ? `${d.riel.toLocaleString()}៛` : "—"}</Td>
                          <Td align="right" className="font-semibold">{usd(d.usdEquivalent)}</Td>
                        </Tr>
                      ))}
                      {/* Totals — dollars and riel each summed on their own, plus
                          the combined USD value. */}
                      <Tr className="border-t-2 border-slate-200 bg-slate-50/60">
                        <Td colSpan={5} className="font-bold uppercase tracking-wide text-slate-500">
                          Total · {num(data.dropTotals.count)} drop{data.dropTotals.count === 1 ? "" : "s"}
                        </Td>
                        <Td align="right" className="font-extrabold text-brand-700">{data.dropTotals.usd > 0 ? usd(data.dropTotals.usd) : "—"}</Td>
                        <Td align="right" className="font-extrabold text-violet-700">{data.dropTotals.riel > 0 ? `${data.dropTotals.riel.toLocaleString()}៛` : "—"}</Td>
                        <Td align="right" className="font-extrabold text-ink-900">{usd(data.dropTotals.usdEquivalent)}</Td>
                      </Tr>
                    </TBody>
                  </Table>
                </div>
              </>
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
