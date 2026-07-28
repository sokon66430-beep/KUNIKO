"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { ShiftTemplate, ScheduleEmployee, Position, RosterEntry } from "@/lib/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s: string) => new Date(s + "T00:00:00");

type ScheduleData = {
  shiftTemplates: ShiftTemplate[];
  positions: Position[];
  employees: ScheduleEmployee[];
  roster: RosterEntry[];
};

// A4 portrait staff-roster sheet — reuses the shared `.po-sheet` print chain so
// it fills the page and drops the app shell when printed.
function RosterPrint() {
  const params = useSearchParams();
  const weekParam = params.get("week") || "";
  const monthParam = params.get("month") || "";
  const isWeek = !!weekParam;
  const now = new Date();

  const { data } = useFetch<ScheduleData>("/api/schedule");
  const { data: session } = useFetch<{ user: { storeName: string } }>("/api/auth/session");
  const storeName = session?.user.storeName || "Stookii";

  const shifts = (data?.shiftTemplates ?? []).filter((s) => s.status === "active");
  const employees = (data?.employees ?? []).filter((e) => e.active !== false);
  const positions = data?.positions ?? [];
  const roster = data?.roster ?? [];

  // Columns to print — one Mon→Sun week, or every day of a month.
  let columns: { date: string; dayNum: number; wd: number }[];
  let title: string;
  if (isWeek) {
    const start = parseIso(weekParam);
    columns = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { date: isoOf(d), dayNum: d.getDate(), wd: d.getDay() };
    });
    const e = new Date(start);
    e.setDate(start.getDate() + 6);
    const sameMonth = start.getMonth() === e.getMonth();
    title = sameMonth
      ? `${start.getDate()}–${e.getDate()} ${MONTHS[start.getMonth()]} ${e.getFullYear()}`
      : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  } else {
    const [ys, ms] = monthParam.split("-");
    const y = Number(ys) || now.getFullYear();
    const m = (Number(ms) || now.getMonth() + 1) - 1;
    const dim = new Date(y, m + 1, 0).getDate();
    columns = Array.from({ length: dim }, (_, i) => {
      const d = new Date(y, m, i + 1);
      return { date: isoOf(d), dayNum: i + 1, wd: d.getDay() };
    });
    title = `${MONTHS[m]} ${y}`;
  }

  const byKey = new Map<string, RosterEntry>();
  roster.forEach((r) => byKey.set(`${r.employeeId}|${r.date}`, r));
  const shiftById = (id?: string) => shifts.find((s) => s.id === id);
  const posName = (id?: string) => positions.find((p) => p.id === id)?.name || "";

  const cellBorder = "0.4mm solid #94a3b8";

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/job-schedule" className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      <div className="roster-sheet bg-white p-6 text-black shadow-card">
        {/* Header */}
        <div className="mb-3 text-center">
          <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>STAFF ROSTER {isWeek ? "— WEEK" : ""}</h1>
          <p style={{ fontSize: 11, fontWeight: 600 }}>{storeName}</p>
          <p style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{title}</p>
        </div>

        {/* Legend */}
        <div className="mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1" style={{ fontSize: 9 }}>
          {shifts.map((s) => (
            <span key={s.id} style={{ fontWeight: 700 }}>
              {s.code} = {s.name} ({s.startTime}–{s.endTime}
              {s.overnight ? " +1" : ""})
            </span>
          ))}
          <span style={{ fontWeight: 700 }}>OFF = Day off</span>
        </div>

        {/* Grid */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 8 }}>
          <thead>
            <tr>
              <th style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", width: isWeek ? "15%" : "14%", fontSize: 8.5 }}>Employee</th>
              <th style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", width: isWeek ? "10%" : "9%", fontSize: 8 }}>Role</th>
              <th style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", width: isWeek ? "11%" : "9%", fontSize: 8 }}>Phone</th>
              {columns.map((c) => {
                const weekend = c.wd === 0 || c.wd === 6;
                return (
                  <th key={c.date} style={{ border: cellBorder, padding: "1px 0", background: weekend ? "#fee2e2" : "#f1f5f9", fontSize: isWeek ? 8 : 7 }}>
                    <div style={{ lineHeight: 1 }}>{c.dayNum}</div>
                    <div style={{ fontSize: isWeek ? 7 : 6, opacity: 0.7 }}>{isWeek ? WEEKDAY3[c.wd] : WEEKDAY[c.wd]}</div>
                  </th>
                );
              })}
              <th style={{ border: cellBorder, padding: "1px 2px", background: "#f1f5f9", fontSize: 7, width: "5%" }}>Wk</th>
            </tr>
          </thead>
          <tbody>
            {/* Grouped BY POSITION, same as the screen roster — the wall copy
                must read the way the store thinks: a section per role. */}
            {[...positions.map((p) => ({ key: p.id, label: p.name, staff: employees.filter((e) => e.positionId === p.id) })),
              { key: "none", label: "No position yet", staff: employees.filter((e) => !e.positionId || !positions.some((p) => p.id === e.positionId)) },
            ]
              .filter((g) => g.staff.length > 0)
              .flatMap((group) => [
                <tr key={"h-" + group.key} style={{ height: 16 }}>
                  <td colSpan={columns.length + 4} style={{ border: cellBorder, padding: "1px 4px", textAlign: "left", fontWeight: 800, fontSize: 8, background: "#e2e8f0", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {group.label} · {group.staff.length}
                  </td>
                </tr>,
                ...group.staff.map((emp) => {
              let work = 0;
              const cells = columns.map((c) => {
                const entry = byKey.get(`${emp.id}|${c.date}`);
                const sh = shiftById(entry?.shiftId);
                if (sh) work++;
                const weekend = c.wd === 0 || c.wd === 6;
                return (
                  <td key={c.date} style={{ border: cellBorder, padding: 0, textAlign: "center", background: weekend ? "#fef2f2" : undefined }}>
                    {sh ? (
                      <span style={{ fontWeight: 800 }}>{sh.code}</span>
                    ) : entry?.off ? (
                      <span style={{ fontSize: isWeek ? 7 : 5.5, fontWeight: 700, color: "#64748b" }}>OFF</span>
                    ) : (
                      ""
                    )}
                  </td>
                );
              });
              return (
                // A real minimum height: short rows are hard to read down a
                // 31-column month and leave no room to hand-write a change.
                <tr key={emp.id} style={{ height: 26 }}>
                  <td style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", fontWeight: 700 }}>{emp.name}</td>
                  <td style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", fontSize: 7 }}>{posName(emp.positionId)}</td>
                  <td style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", fontSize: 7.5, whiteSpace: "nowrap" }}>{emp.phone || ""}</td>
                  {cells}
                  <td style={{ border: cellBorder, padding: 0, textAlign: "center", fontWeight: 700 }}>{work}</td>
                </tr>
              );
                }),
              ])}
          </tbody>
          {/* Daily manpower — how many staff are on each shift, per day.
              Two blank rows separate it from the roster so it reads clearly. */}
          <tfoot>
            <tr style={{ height: 9 }}>
              <td colSpan={columns.length + 4} style={{ border: "none" }} />
            </tr>
            <tr style={{ height: 9 }}>
              <td colSpan={columns.length + 4} style={{ border: "none" }} />
            </tr>
            <tr style={{ height: 20 }}>
              <td colSpan={3} style={{ border: cellBorder, padding: "2px 4px", textAlign: "left", fontWeight: 800, fontSize: 8, background: "#e2e8f0" }}>
                DAILY MANPOWER — staff per shift
              </td>
              {columns.map((c) => (
                <td key={c.date} style={{ border: cellBorder, background: "#e2e8f0" }} />
              ))}
              <td style={{ border: cellBorder, background: "#e2e8f0" }} />
            </tr>
            {shifts.map((s) => {
              let total = 0;
              return (
                <tr key={s.id} style={{ background: "#f8fafc", height: 22 }}>
                  <td colSpan={3} style={{ border: cellBorder, padding: "2px 4px", textAlign: "right", fontWeight: 700, fontSize: 7.5 }}>
                    {s.code} · {s.name}
                  </td>
                  {columns.map((c) => {
                    const n = employees.filter((e) => byKey.get(`${e.id}|${c.date}`)?.shiftId === s.id).length;
                    total += n;
                    const weekend = c.wd === 0 || c.wd === 6;
                    return (
                      <td key={c.date} style={{ border: cellBorder, padding: 0, textAlign: "center", fontWeight: 700, background: weekend ? "#fef2f2" : undefined }}>
                        {n || ""}
                      </td>
                    );
                  })}
                  <td style={{ border: cellBorder, padding: 0, textAlign: "center", fontWeight: 700 }}>{total}</td>
                </tr>
              );
            })}
            <tr style={{ background: "#eef2fb", height: 22 }}>
              <td colSpan={3} style={{ border: cellBorder, padding: "2px 4px", textAlign: "right", fontWeight: 800, fontSize: 7.5 }}>On duty / day</td>
              {columns.map((c) => {
                const n = employees.filter((e) => {
                  const sh = byKey.get(`${e.id}|${c.date}`)?.shiftId;
                  return sh && shifts.some((x) => x.id === sh);
                }).length;
                const weekend = c.wd === 0 || c.wd === 6;
                return (
                  <td key={c.date} style={{ border: cellBorder, padding: 0, textAlign: "center", fontWeight: 800, background: weekend ? "#fef2f2" : undefined }}>
                    {n || ""}
                  </td>
                );
              })}
              <td style={{ border: cellBorder, padding: 0 }} />
            </tr>
          </tfoot>
        </table>

        <p style={{ fontSize: 8, color: "#64748b", marginTop: 8, textAlign: "right" }}>
          Printed from Stookii · {title}
        </p>
      </div>

      {/* Print this roster on A4 LANDSCAPE — the day columns need the width. The
          app shell is dropped and the sheet is pinned to the full landscape
          printable area (297mm − 2×8mm ≈ 281mm) so nothing scales down. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          aside, .no-print, .fixed { display: none !important; }
          body { background: #fff !important; }
          main:has(.roster-sheet) { width: 281mm !important; max-width: 281mm !important; padding: 0 !important; margin: 0 !important; }
          main:has(.roster-sheet) > div,
          main:has(.roster-sheet) > div > div { width: 281mm !important; max-width: 281mm !important; margin: 0 !important; padding: 0 !important; }
          .roster-sheet {
            width: 281mm !important; max-width: 281mm !important;
            margin: 0 !important; padding: 0 !important;
            border: none !important; box-shadow: none !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

export default function RosterPrintPage() {
  return (
    <Suspense fallback={null}>
      <RosterPrint />
    </Suspense>
  );
}
