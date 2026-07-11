"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, ShieldCheck, PackageSearch, ChevronRight } from "lucide-react";

// Notification bell — unread badge + dropdown fed by /api/notifications.
// "Read" state is the timestamp of the last time the panel was opened,
// remembered per browser (localStorage), so the badge only counts new events.
type Action = { id: string; title: string; detail: string; href: string; tone: "amber" | "rose" | "brand" };
type Event = { id: string; at: string; actor: string; action: string; entityType: string; entity: string; detail: string };

const SEEN_KEY = "stookii-notif-seen";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TONE: Record<Action["tone"], string> = {
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  brand: "bg-brand-50 text-brand-600",
};
const TONE_ICON: Record<Action["tone"], typeof Bell> = {
  amber: ShieldCheck,
  rose: AlertTriangle,
  brand: PackageSearch,
};

export function NotificationBell({ align = "right" }: { align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [seen, setSeen] = useState<string>("");

  useEffect(() => {
    setSeen(localStorage.getItem(SEEN_KEY) || "");
    let alive = true;
    const load = () =>
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) {
            setActions(d.actions || []);
            setEvents(d.events || []);
          }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000); // refresh every minute
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const unread = useMemo(() => events.filter((e) => !seen || e.at > seen).length, [events, seen]);
  const hasActions = actions.length > 0;

  function openPanel() {
    setOpen((v) => {
      const next = !v;
      if (next) {
        // Opening marks everything as read.
        const now = new Date().toISOString();
        localStorage.setItem(SEEN_KEY, now);
        setSeen(now);
      }
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPanel}
        title="Notifications"
        className="relative grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-ink-900"
      >
        <Bell size={18} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : hasActions ? (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
        ) : null}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] animate-fade-up overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-slate-900/[0.08] ${
              align === "left" ? "left-0" : "right-0"
            }`}
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-ink-900">Notifications</p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {/* Needs attention */}
              {hasActions && (
                <div className="border-b border-slate-100 p-2">
                  {actions.map((a) => {
                    const Icon = TONE_ICON[a.tone];
                    return (
                      <Link
                        key={a.id}
                        href={a.href}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-slate-50"
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${TONE[a.tone]}`}>
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-snug text-ink-800">{a.title}</span>
                          {a.detail && <span className="block truncate text-[11px] text-slate-400">{a.detail}</span>}
                        </span>
                        <ChevronRight size={15} className="shrink-0 text-slate-300" />
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Recent activity */}
              {events.length === 0 && !hasActions ? (
                <p className="px-4 py-10 text-center text-sm text-slate-400">Nothing new — you&apos;re all caught up.</p>
              ) : (
                <div className="p-2">
                  {events.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 rounded-xl px-2.5 py-2">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-200" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-ink-800">
                          <b>{e.actor}</b> {e.action.toLowerCase()} <b>{e.entity}</b>
                          {e.detail ? <span className="text-slate-500"> — {e.detail}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-400">{timeAgo(e.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
