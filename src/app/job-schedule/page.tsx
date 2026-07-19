"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  Users,
  Clock,
  MapPin,
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Phone,
  Moon,
  ChevronLeft,
  ChevronRight,
  Printer,
  Eraser,
  Lock,
  KeyRound,
} from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { canAssignRoster } from "@/lib/access";
import type { ShiftTemplate, Station, Position, ScheduleEmployee, RosterEntry } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, EmptyState, Modal } from "@/components/ui";

// The API never sends the PIN hash — just a `hasPin` flag (who can sign into the till).
type Emp = ScheduleEmployee & { hasPin?: boolean };

type ScheduleData = {
  shiftTemplates: ShiftTemplate[];
  stations: Station[];
  positions: Position[];
  employees: Emp[];
  roster: any[];
};

type Tab = "dashboard" | "roster" | "employees" | "shifts" | "setup";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "dashboard", label: "Dashboard", icon: CalendarClock },
  { id: "roster", label: "Roster", icon: CalendarDays },
  { id: "employees", label: "Employees", icon: Users },
  { id: "shifts", label: "Shift Management", icon: Clock },
  { id: "setup", label: "Stations & Positions", icon: MapPin },
];

// Shift tint used across the grid + chips, matching the brand palette.
const SHIFT_TINT: Record<string, string> = {
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};
const tint = (c?: string) => SHIFT_TINT[c || "slate"] || SHIFT_TINT.slate;

export default function JobSchedulePage() {
  const { data, loading, error, reload } = useFetch<ScheduleData>("/api/schedule");
  const [tab, setTab] = useState<Tab>("dashboard");
  const role = useRole();
  const canAssign = !!role && canAssignRoster(role);

  const d = data;
  const shifts = d?.shiftTemplates ?? [];
  const stations = d?.stations ?? [];
  const positions = d?.positions ?? [];
  const employees = d?.employees ?? [];
  const roster = d?.roster ?? [];
  const activeStaff = employees.filter((e) => e.active !== false);

  return (
    <div>
      <PageHeader
        title="Job Schedule"
        subtitle="Retail workforce management — shifts, staff roster, stations and manpower for this store."
      />

      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading && !d ? (
        <Spinner label="Loading schedule…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !d ? null : (
        <>
          {tab === "dashboard" && (
            <DashboardTab shifts={shifts} stations={stations} positions={positions} employees={activeStaff} />
          )}
          {tab === "roster" && (
            <RosterTab shifts={shifts} employees={activeStaff} roster={roster} canAssign={canAssign} reload={reload} />
          )}
          {tab === "employees" && (
            <EmployeesTab employees={employees} shifts={shifts} stations={stations} positions={positions} reload={reload} />
          )}
          {tab === "shifts" && <ShiftsTab shifts={shifts} reload={reload} />}
          {tab === "setup" && <SetupTab stations={stations} positions={positions} reload={reload} />}
        </>
      )}
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function DashboardTab({
  shifts,
  stations,
  positions,
  employees,
}: {
  shifts: ShiftTemplate[];
  stations: Station[];
  positions: Position[];
  employees: ScheduleEmployee[];
}) {
  // How many staff default to each shift (a quick manpower read until the roster
  // is planned in Phase 2).
  const byShift = useMemo(() => {
    const m = new Map<string, number>();
    employees.forEach((e) => e.defaultShiftId && m.set(e.defaultShiftId, (m.get(e.defaultShiftId) || 0) + 1));
    return m;
  }, [employees]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active staff" value={String(employees.length)} icon={<Users size={18} />} accent="brand" />
        <StatCard label="Shifts" value={String(shifts.filter((s) => s.status === "active").length)} icon={<Clock size={18} />} accent="violet" />
        <StatCard label="Stations" value={String(stations.length)} icon={<MapPin size={18} />} accent="emerald" />
        <StatCard label="Positions" value={String(positions.length)} icon={<Briefcase size={18} />} accent="amber" />
      </div>

      <Card title="Manpower by shift (default assignment)" icon={<CalendarClock size={16} className="text-brand-600" />}>
        {shifts.length === 0 ? (
          <EmptyState title="No shifts yet" hint="Add shifts in Shift Management." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {shifts
              .filter((s) => s.status === "active")
              .map((s) => (
                <div key={s.id} className={`rounded-xl px-4 py-3 ring-1 ${tint(s.color)}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {s.code} · {s.name}
                    </span>
                    {s.overnight && <Moon size={13} className="opacity-70" />}
                  </div>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums">{byShift.get(s.id) || 0}</p>
                  <p className="text-xs opacity-80">
                    {s.startTime}–{s.endTime}
                    {s.overnight ? " (+1)" : ""}
                  </p>
                </div>
              ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Counts are each employee&apos;s <b>default</b> shift. Day-by-day planning and warnings arrive with the Monthly Roster.
        </p>
      </Card>
    </div>
  );
}

// ── Roster (Monthly + Weekly) ────────────────────────────────────────────────
// The Excel replacement: rows = staff, columns = dates (a whole month, or a
// single Monday→Sunday week). A manager or area manager paints each cell — pick a
// shift (or OFF / erase) from the toolbar, then click (or click-drag) across
// cells. Everyone else sees it read-only.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s: string) => new Date(s + "T00:00:00");
// The Monday that starts the week containing `d` (weeks restart every Monday).
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const wd = x.getDay(); // 0=Sun … 6=Sat
  x.setDate(x.getDate() + (wd === 0 ? -6 : 1 - wd));
  return x;
}

type CellEdit = { shiftId?: string; off?: boolean; clear?: boolean };

function RosterTab({
  shifts,
  employees,
  roster,
  canAssign,
  reload,
}: {
  shifts: ShiftTemplate[];
  employees: ScheduleEmployee[];
  roster: RosterEntry[];
  canAssign: boolean;
  reload: () => void;
}) {
  const activeShifts = shifts.filter((s) => s.status === "active");
  const today = new Date();
  const [view, setView] = useState<"month" | "week">("week");
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [weekStart, setWeekStart] = useState<string>(() => iso(mondayOf(today))); // Monday ISO
  const [brush, setBrush] = useState<string>(activeShifts[0]?.id ?? "OFF"); // shiftId | "OFF" | "ERASE"
  const [edits, setEdits] = useState<Map<string, CellEdit>>(new Map());
  const [painting, setPainting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Stop painting when the mouse is released ANYWHERE (even off the grid), so a
  // brush can never "stick" and keep filling cells the pointer only passes over.
  useEffect(() => {
    const up = () => setPainting(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // The columns to draw — a Mon→Sun week, or every day of the month.
  const columns = useMemo(() => {
    if (view === "week") {
      const start = parseIso(weekStart);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return { date: iso(d), dayNum: d.getDate(), wd: d.getDay(), monthAbbr: MONTHS[d.getMonth()] };
      });
    }
    const dim = new Date(ym.y, ym.m + 1, 0).getDate();
    return Array.from({ length: dim }, (_, i) => {
      const d = new Date(ym.y, ym.m, i + 1);
      return { date: iso(d), dayNum: i + 1, wd: d.getDay(), monthAbbr: MONTHS[d.getMonth()] };
    });
  }, [view, ym, weekStart]);

  // Server truth keyed by employee|date (all entries — cheap, one store).
  const base = useMemo(() => {
    const m = new Map<string, RosterEntry>();
    roster.forEach((r) => m.set(`${r.employeeId}|${r.date}`, r));
    return m;
  }, [roster]);

  const shiftById = (id?: string) => activeShifts.find((s) => s.id === id) || shifts.find((s) => s.id === id);
  const dirty = edits.size > 0;

  const rangeLabel = useMemo(() => {
    if (view === "week") {
      const s = parseIso(weekStart);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      const sameMonth = s.getMonth() === e.getMonth();
      return sameMonth
        ? `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]} ${e.getFullYear()}`
        : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
    }
    return `${MONTHS[ym.m]} ${ym.y}`;
  }, [view, ym, weekStart]);

  const printUrl = view === "week" ? `/job-schedule/print?week=${weekStart}` : `/job-schedule/print?month=${ym.y}-${pad(ym.m + 1)}`;

  // What a cell shows = pending edit if any, else server truth.
  function cellState(key: string): { shiftId?: string; off?: boolean } {
    if (edits.has(key)) {
      const e = edits.get(key)!;
      if (e.clear) return {};
      return { shiftId: e.shiftId, off: e.off };
    }
    const b = base.get(key);
    return b ? { shiftId: b.shiftId, off: b.off } : {};
  }

  function apply(empId: string, date: string) {
    if (!canAssign) return;
    const key = `${empId}|${date}`;
    const next: CellEdit =
      brush === "ERASE" ? { clear: true } : brush === "OFF" ? { off: true } : { shiftId: brush };
    setEdits((prev) => new Map(prev).set(key, next));
  }

  // Move one period back/forward. Unsaved edits are kept (they're keyed by date,
  // so painting across weeks and saving once is fine).
  function nav(delta: number) {
    if (view === "week") {
      const d = parseIso(weekStart);
      d.setDate(d.getDate() + delta * 7);
      setWeekStart(iso(d));
    } else {
      const d = new Date(ym.y, ym.m + delta, 1);
      setYm({ y: d.getFullYear(), m: d.getMonth() });
    }
  }

  async function save() {
    setBusy(true);
    try {
      const cells = [...edits.entries()].map(([key, e]) => {
        const [employeeId, date] = key.split("|");
        if (e.clear) return { employeeId, date };
        return { employeeId, date, shiftId: e.shiftId, off: e.off };
      });
      await api("/api/schedule/roster", { method: "POST", body: JSON.stringify({ cells }) });
      setEdits(new Map());
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (employees.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Users size={20} />} title="No employees yet" hint="Add staff in the Employees tab, then come back to build the roster." />
      </Card>
    );
  }

  const brushBtn = (id: string, label: string, cls: string) => (
    <button
      key={id}
      onClick={() => setBrush(id)}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold ring-1 transition ${
        brush === id ? `${cls} ring-2 ring-offset-1` : `${cls} opacity-60 hover:opacity-100`
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Week / Month toggle */}
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${
                  view === v ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => nav(-1)} className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] text-center text-sm font-bold text-ink-900">{rangeLabel}</span>
          <button onClick={() => nav(1)} className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(printUrl, "_blank")}
            className="btn-ghost !py-2"
            disabled={dirty}
            title={dirty ? "Save changes first" : "Print A4 (portrait)"}
          >
            <Printer size={16} /> Print A4
          </button>
          {canAssign && (
            <button className="btn-primary !py-2" disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : dirty ? `Save ${edits.size} change${edits.size === 1 ? "" : "s"}` : "Saved"}
            </button>
          )}
        </div>
      </div>

      {/* Brush palette (assign mode) */}
      {canAssign ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <span className="text-xs font-semibold text-slate-500">Paint with:</span>
          {activeShifts.map((s) => brushBtn(s.id, `${s.code} · ${s.name}`, tint(s.color)))}
          {brushBtn("OFF", "OFF", "bg-slate-200 text-slate-600 ring-slate-300")}
          {brushBtn("ERASE", "Erase", "bg-white text-slate-500 ring-slate-300")}
          <span className="ml-auto hidden items-center gap-1 text-xs text-slate-400 sm:flex">
            <Eraser size={12} /> Click a cell, or click-drag to fill many.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
          <Lock size={13} /> View only — a manager or area manager assigns the roster.
        </div>
      )}

      {/* The grid */}
      <div className="overflow-x-auto rounded-xl border border-slate-200" onMouseLeave={() => setPainting(false)}>
        <table className="border-collapse text-center text-xs" style={{ userSelect: "none" }}>
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-bold text-slate-600" style={{ minWidth: 150 }}>
                Employee
              </th>
              {columns.map((c) => {
                const weekend = c.wd === 0 || c.wd === 6;
                return (
                  <th key={c.date} className={`border-b border-slate-200 px-0 py-1 font-bold ${weekend ? "bg-rose-50 text-rose-500" : "text-slate-500"}`} style={{ minWidth: view === "week" ? 70 : 30 }}>
                    <div className="leading-none">{c.dayNum}</div>
                    <div className="text-[9px] font-medium opacity-70">{view === "week" ? WEEKDAY3[c.wd] : WEEKDAY[c.wd]}</div>
                  </th>
                );
              })}
              <th className="border-b border-l border-slate-200 px-2 py-1 font-bold text-slate-500" style={{ minWidth: 42 }}>
                Work
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              let work = 0;
              const row = columns.map((c) => {
                const key = `${emp.id}|${c.date}`;
                const st = cellState(key);
                const sh = shiftById(st.shiftId);
                if (sh) work++;
                const weekend = c.wd === 0 || c.wd === 6;
                return (
                  <td
                    key={c.date}
                    onMouseDown={() => {
                      if (!canAssign) return;
                      setPainting(true);
                      apply(emp.id, c.date);
                    }}
                    onMouseEnter={() => painting && apply(emp.id, c.date)}
                    onMouseUp={() => setPainting(false)}
                    className={`border-b border-r border-slate-100 p-0 ${canAssign ? "cursor-pointer" : ""} ${weekend ? "bg-rose-50/40" : ""}`}
                  >
                    {sh ? (
                      <div className={`m-0.5 grid h-7 place-items-center rounded font-extrabold ring-1 ${tint(sh.color)}`} title={`${sh.name} ${sh.startTime}–${sh.endTime}`}>
                        {sh.code}
                      </div>
                    ) : st.off ? (
                      <div className="m-0.5 grid h-7 place-items-center rounded bg-slate-100 text-[9px] font-bold text-slate-400">OFF</div>
                    ) : (
                      <div className="m-0.5 h-7 rounded hover:bg-brand-50" />
                    )}
                  </td>
                );
              });
              return (
                <tr key={emp.id} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left dark:bg-slate-900">
                    <div className="truncate text-xs font-bold text-ink-900 dark:text-slate-100" style={{ maxWidth: 150 }}>
                      {emp.name}
                    </div>
                  </td>
                  {row}
                  <td className="border-b border-l border-slate-200 px-2 py-1 font-bold tabular-nums text-slate-600">{work}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-semibold">Legend:</span>
        {activeShifts.map((s) => (
          <span key={s.id} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold ring-1 ${tint(s.color)}`}>
            {s.code} = {s.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-400">OFF = Day off</span>
      </div>
    </div>
  );
}

// ── Employees ────────────────────────────────────────────────────────────────
function EmployeesTab({
  employees,
  shifts,
  stations,
  positions,
  reload,
}: {
  employees: Emp[];
  shifts: ShiftTemplate[];
  stations: Station[];
  positions: Position[];
  reload: () => void;
}) {
  const [editing, setEditing] = useState<Emp | null>(null);
  const [adding, setAdding] = useState(false);
  const posName = (id?: string) => positions.find((p) => p.id === id)?.name;
  const stnName = (id?: string) => stations.find((s) => s.id === id)?.name;
  const shift = (id?: string) => shifts.find((s) => s.id === id);

  async function remove(e: ScheduleEmployee) {
    if (!confirm(`Remove ${e.name} from the staff roster?`)) return;
    await api(`/api/schedule/employees?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    reload();
  }

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-ink-900">
            <Users size={16} className="text-brand-600" /> Staff roster
          </div>
          <p className="mt-0.5 text-xs text-slate-400">The people this store schedules. Most crew don&apos;t need a POS login.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add employee
        </button>
      </div>

      {employees.length === 0 ? (
        <EmptyState title="No employees yet" hint="Add your first staff member to start scheduling." />
      ) : (
        <div className="space-y-2">
          {employees.map((e) => {
            const sh = shift(e.defaultShiftId);
            return (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                  {e.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink-900 dark:text-slate-100">
                    {e.name}
                    {e.active === false && <span className="ml-2 text-xs font-semibold text-slate-400">(inactive)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {posName(e.positionId) && <span>{posName(e.positionId)}</span>}
                    {stnName(e.stationId) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} /> {stnName(e.stationId)}
                      </span>
                    )}
                    {e.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={11} /> {e.phone}
                      </span>
                    )}
                  </p>
                </div>
                {e.hasPin && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200" title="Can sign into the till with a PIN">
                    <KeyRound size={11} /> POS login
                  </span>
                )}
                {sh && (
                  <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ring-1 ${tint(sh.color)}`}>
                    {sh.code} · {sh.name}
                  </span>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditing(e)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => remove(e)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    title="Remove"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(adding || editing) && (
        <EmployeeModal
          employee={editing}
          shifts={shifts}
          stations={stations}
          positions={positions}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function EmployeeModal({
  employee,
  shifts,
  stations,
  positions,
  onClose,
  onSaved,
}: {
  employee: Emp | null;
  shifts: ShiftTemplate[];
  stations: Station[];
  positions: Position[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(employee?.name ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [positionId, setPositionId] = useState(employee?.positionId ?? "");
  const [stationId, setStationId] = useState(employee?.stationId ?? "");
  const [defaultShiftId, setDefaultShiftId] = useState(employee?.defaultShiftId ?? "");
  const [active, setActive] = useState(employee?.active !== false);
  const [pin, setPin] = useState(""); // blank = keep existing (edit) / no login (new)
  const [busy, setBusy] = useState(false);
  const pinValid = pin === "" || /^\d{6}$/.test(pin);

  async function save() {
    if (!name.trim() || !pinValid) return;
    setBusy(true);
    try {
      // Only send `pin` when the box was touched — blank leaves it unchanged.
      const payload: any = { name, phone, positionId, stationId, defaultShiftId, active };
      if (pin !== "") payload.pin = pin;
      if (employee) {
        await api("/api/schedule/employees", { method: "PATCH", body: JSON.stringify({ id: employee.id, ...payload }) });
      } else {
        await api("/api/schedule/employees", { method: "POST", body: JSON.stringify(payload) });
      }
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
      onClose={onClose}
      title={employee ? "Edit employee" : "Add employee"}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !name.trim() || !pinValid} onClick={save}>
            {busy ? "Saving…" : employee ? "Save changes" : "Add employee"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Full name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hak Sreymey" autoFocus />
        </div>
        <div>
          <label className="label">Phone number</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 012 345 678" />
        </div>
        <div>
          <label className="label">Position</label>
          <select className="input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">— none —</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Station</label>
          <select className="input" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">— none —</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Default shift</label>
          <select className="input" value={defaultShiftId} onChange={(e) => setDefaultShiftId(e.target.value)}>
            <option value="">— none —</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name} ({s.startTime}–{s.endTime})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* POS PIN — lets this staff sign into the till by name. */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-bold text-ink-900 dark:text-slate-100">
              <KeyRound size={14} className="text-brand-600" /> POS login PIN
              <span className="text-xs font-medium text-slate-400">optional</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Lets this staff sign into the till by name. Leave blank for no login.
            </p>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d*"
            maxLength={6}
            className="input w-32 shrink-0 text-center font-semibold"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={employee?.hasPin ? "••••••" : "6 digits"}
          />
        </div>
        {employee?.hasPin && pin === "" && (
          <p className="mt-2 text-xs text-slate-400">A PIN is already set — type a new one to change it.</p>
        )}
        {!pinValid && <p className="mt-2 text-xs font-semibold text-rose-600">PIN must be exactly 6 digits.</p>}
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
        />
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          Active on the schedule
          <span className="font-normal text-slate-400"> — uncheck to keep on file but off the roster</span>
        </span>
      </label>
    </Modal>
  );
}

// ── Shift Management ─────────────────────────────────────────────────────────
function ShiftsTab({ shifts, reload }: { shifts: ShiftTemplate[]; reload: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, patch: Partial<ShiftTemplate>) {
    setBusyId(id);
    try {
      await api("/api/schedule/shifts", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card
      title="Shift Management"
      subtitle="The store runs 24 hours across these shifts. Edit the check-in / check-out times any time."
      icon={<Clock size={16} className="text-brand-600" />}
    >
      <div className="space-y-3">
        {shifts.map((s) => (
          <ShiftRow key={s.id} shift={s} busy={busyId === s.id} onSave={(p) => patch(s.id, p)} />
        ))}
      </div>
    </Card>
  );
}

function ShiftRow({ shift, busy, onSave }: { shift: ShiftTemplate; busy: boolean; onSave: (p: Partial<ShiftTemplate>) => void }) {
  const [name, setName] = useState(shift.name);
  const [start, setStart] = useState(shift.startTime);
  const [end, setEnd] = useState(shift.endTime);
  const [overnight, setOvernight] = useState(!!shift.overnight);
  const dirty = name !== shift.name || start !== shift.startTime || end !== shift.endTime || overnight !== !!shift.overnight;

  return (
    <div className={`rounded-xl border px-4 py-3 ${shift.status === "inactive" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
      <div className="flex flex-wrap items-end gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-extrabold ring-1 ${tint(shift.color)}`}>
          {shift.code}
        </span>
        <div className="min-w-[120px] flex-1">
          <label className="label">Shift name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Check in</label>
          <input type="time" className="input w-32" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Check out</label>
          <input type="time" className="input w-32" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 pb-2.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={overnight} onChange={(e) => setOvernight(e.target.checked)} className="h-4 w-4 rounded" />
          <Moon size={13} /> Next day
        </label>
        <div className="flex items-center gap-2 pb-1">
          <button
            className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => onSave({ status: shift.status === "active" ? "inactive" : "active" })}
            disabled={busy}
          >
            {shift.status === "active" ? "Disable" : "Enable"}
          </button>
          <button
            className="btn-primary !py-2"
            disabled={busy || !dirty}
            onClick={() => onSave({ name, startTime: start, endTime: end, overnight })}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stations & Positions ─────────────────────────────────────────────────────
function SetupTab({ stations, positions, reload }: { stations: Station[]; positions: Position[]; reload: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ListEditor
        title="Stations"
        subtitle="Work areas staff are assigned to on a shift."
        icon={<MapPin size={16} className="text-brand-600" />}
        items={stations}
        field="stations"
        reload={reload}
      />
      <ListEditor
        title="Positions"
        subtitle="Job titles used across the roster."
        icon={<Briefcase size={16} className="text-brand-600" />}
        items={positions}
        field="positions"
        reload={reload}
      />
    </div>
  );
}

function ListEditor({
  title,
  subtitle,
  icon,
  items,
  field,
  reload,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: { id: string; name: string }[];
  field: "stations" | "positions";
  reload: () => void;
}) {
  const [rows, setRows] = useState(items.map((i) => ({ ...i })));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(items);

  async function save() {
    setBusy(true);
    try {
      await api("/api/schedule/config", { method: "PATCH", body: JSON.stringify({ [field]: rows.filter((r) => r.name.trim()) }) });
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={title} subtitle={subtitle} icon={icon}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id || i} className="flex items-center gap-2">
            <input
              className="input"
              value={r.name}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <button
              className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              title="Remove"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="btn-ghost mt-2 !py-1.5 text-xs"
        onClick={() => setRows([...rows, { id: "", name: "" }])}
      >
        <Plus size={14} /> Add {title.toLowerCase().replace(/s$/, "")}
      </button>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Card>
  );
}
