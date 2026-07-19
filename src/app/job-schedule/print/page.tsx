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

      <div className="po-sheet bg-white p-6 text-black shadow-card">
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
              <th style={{ border: cellBorder, padding: "2px 3px", textAlign: "left", width: isWeek ? "20%" : "26%", fontSize: 8.5 }}>Employee</th>
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
            {employees.map((emp) => {
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
                <tr key={emp.id}>
                  <td style={{ border: cellBorder, padding: "2px 3px", textAlign: "left" }}>
                    <span style={{ fontWeight: 700 }}>{emp.name}</span>
                    {posName(emp.positionId) && <span style={{ fontSize: 6.5, color: "#64748b" }}> · {posName(emp.positionId)}</span>}
                  </td>
                  {cells}
                  <td style={{ border: cellBorder, padding: 0, textAlign: "center", fontWeight: 700 }}>{work}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p style={{ fontSize: 8, color: "#64748b", marginTop: 8, textAlign: "right" }}>
          Printed from Stookii · {title}
        </p>
      </div>
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
