"use client";

import { useMemo, useState } from "react";
import {
  History,
  FileText,
  ClipboardList,
  ClipboardCheck,
  PackageCheck,
  Barcode,
  Truck,
  Package,
  User,
  Filter,
  ShoppingCart,
} from "lucide-react";
import { useFetch } from "@/lib/client";
import type { AuditEvent, AuditEntityType } from "@/lib/types";
import { PageHeader, StatCard, Card, Spinner, EmptyState } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { num } from "@/lib/format";

const TYPE_META: Record<AuditEntityType, { icon: any; tint: string }> = {
  PR: { icon: FileText, tint: "bg-brand-50 text-brand-600" },
  PO: { icon: ClipboardList, tint: "bg-violet-50 text-violet-600" },
  GRN: { icon: PackageCheck, tint: "bg-emerald-50 text-emerald-600" },
  Product: { icon: Barcode, tint: "bg-slate-100 text-slate-600" },
  Supplier: { icon: Truck, tint: "bg-amber-50 text-amber-600" },
  Stock: { icon: Package, tint: "bg-emerald-50 text-emerald-600" },
  Count: { icon: ClipboardCheck, tint: "bg-brand-50 text-brand-600" },
  WriteOff: { icon: Package, tint: "bg-rose-50 text-rose-600" },
  Sale: { icon: ShoppingCart, tint: "bg-brand-50 text-brand-600" },
};

const ACTION_COLOR: Record<string, string> = {
  Approved: "text-emerald-600",
  Rejected: "text-rose-600",
  Cancelled: "text-rose-600",
  Deleted: "text-rose-600",
  Created: "text-brand-600",
  Received: "text-emerald-600",
  Converted: "text-violet-600",
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function AuditPage() {
  const { data: events, loading } = useFetch<AuditEvent[]>("/api/audit");
  const [type, setType] = useState("All");
  const [actor, setActor] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const all = events || [];
  const actors = useMemo(() => Array.from(new Set(all.map((e) => e.actor))).sort(), [all]);

  const filtered = useMemo(
    () =>
      all
        .filter((e) => type === "All" || e.entityType === type)
        .filter((e) => actor === "All" || e.actor === actor)
        .filter((e) => {
          const day = e.at.slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
    [all, type, actor, from, to],
  );

  // Group filtered events by calendar day (already newest-first from the API).
  const grouped = useMemo(() => {
    const map = new Map<string, AuditEvent[]>();
    for (const e of filtered) {
      const key = e.at.slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return [...map.entries()];
  }, [filtered]);

  const poEvents = filtered.filter((e) => e.entityType === "PO").length;
  const prEvents = filtered.filter((e) => e.entityType === "PR").length;
  const receipts = filtered.filter((e) => e.entityType === "GRN").length;

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Every action across procurement — who did what, and when" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Events" value={num(filtered.length)} icon={<History size={18} />} accent="brand" />
        <StatCard label="PR Activity" value={num(prEvents)} icon={<FileText size={18} />} accent="violet" />
        <StatCard label="PO Activity" value={num(poEvents)} icon={<ClipboardList size={18} />} accent="amber" />
        <StatCard label="Goods Received" value={num(receipts)} icon={<PackageCheck size={18} />} accent="emerald" />
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input sm:w-40" value={type} onChange={(e) => setType(e.target.value)}>
              {["All", "PR", "PO", "GRN", "Product", "Supplier", "Stock"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Actor</label>
            <select className="input sm:w-44" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option>All</option>
              {actors.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} />
          </div>
          <button
            onClick={() => {
              setType("All");
              setActor("All");
              setFrom("");
              setTo("");
            }}
            className="btn-ghost"
          >
            <Filter size={16} /> Reset
          </button>
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-0">
        {loading ? (
          <Spinner label="Loading activity…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No activity" hint="Actions across procurement will appear here." />
        ) : (
          <div className="divide-y divide-slate-100">
            {grouped.map(([day, dayEvents]) => (
              <div key={day}>
                <div className="sticky top-0 bg-slate-50/80 px-5 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 backdrop-blur">
                  {dayLabel(day + "T00:00:00")}
                </div>
                <ul>
                  {dayEvents.map((e) => {
                    const meta = TYPE_META[e.entityType];
                    const Icon = meta.icon;
                    return (
                      <li key={e.id} className="flex items-start gap-3.5 px-5 py-3 hover:bg-slate-50/60">
                        <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${meta.tint}`}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink-800">
                            <span className={`font-semibold ${ACTION_COLOR[e.action] || "text-ink-900"}`}>
                              {e.action}
                            </span>{" "}
                            <span className="font-semibold text-ink-900">{e.entity}</span>
                            {e.detail ? <span className="text-slate-500"> · {e.detail}</span> : null}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                            <User size={11} /> {e.actor}
                            <span className="text-slate-300">·</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              {e.entityType}
                            </span>
                          </p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{timeLabel(e.at)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
