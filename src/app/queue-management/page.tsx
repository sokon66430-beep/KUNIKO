"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, Play, Check, PackageCheck, Wifi, WifiOff, Clock, Monitor } from "lucide-react";
import { api } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox, EmptyState } from "@/components/ui";

// ---------------------------------------------------------------------------
// Queue Management — the screen that actually MOVES the queue.
//
// Everything else in the queue module is automatic: the till issues the number,
// the TV shows it. This is the one place a human pushes an order along, so it is
// built for someone standing at a counter with wet hands and no time:
//
//  - One card per order, oldest first. The order to cook IS the reading order.
//  - Exactly one obvious button per card. Never a choice of two.
//  - Touch targets big enough for a thumb, on a tablet, at arm's length.
//  - No refresh, ever: it rides the same live feed as the TVs.
//
// Deliberately NOT a table. A table is for reading; this is for pressing.
// ---------------------------------------------------------------------------

type Item = { name: string; qty: number; note?: string };
type Job = { stationId: string; stationName: string; status: Status; items: Item[] };
type Status = "waiting" | "preparing" | "ready" | "completed" | "cancelled";
type Ticket = {
  id: string;
  code: string;
  status: Status;
  receiptNo: string;
  cashier: string;
  terminal: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  items: Item[];
  jobs: Job[];
  laneStatus: Status;
};
type Data = {
  today: string;
  stations: { id: string; name: string }[];
  station: string | null;
  tickets: Ticket[];
};

/** How long this order has been waiting, in plain words. */
function since(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} hr ${mins % 60} min`;
}

// The single next action for a card. One button, never a menu — a cook should
// press the same place every time without reading it.
const ACTION: Record<string, { next: Status; label: string; icon: typeof Play; className: string } | null> = {
  waiting: { next: "preparing", label: "START", icon: Play, className: "bg-brand-600 hover:bg-brand-700" },
  preparing: { next: "ready", label: "READY", icon: Check, className: "bg-emerald-600 hover:bg-emerald-700" },
  ready: { next: "completed", label: "PICKED UP", icon: PackageCheck, className: "bg-slate-700 hover:bg-slate-800" },
  completed: null,
  cancelled: null,
};

export default function QueueManagementPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Read inside the SSE handler, which is set up once — without the ref a
  // station change would keep reloading the station selected at mount.
  const stationRef = useRef(station);
  useEffect(() => {
    stationRef.current = station;
  }, [station]);

  const load = useCallback(async () => {
    try {
      const s = stationRef.current;
      setData(await api<Data>(`/api/queue/kitchen${s ? `?station=${encodeURIComponent(s)}` : ""}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, station]);

  useEffect(() => {
    // Same feed the customer TVs use: a till taking payment puts the order on
    // this screen within a second, with nobody refreshing anything.
    const es = new EventSource("/api/queue/stream");
    es.addEventListener("ready", () => {
      setLive(true);
      load(); // resync on every (re)connect, so a missed event can't leave stale
    });
    es.addEventListener("queue:changed", () => load());
    es.onerror = () => setLive(false); // EventSource retries by itself
    const poll = setInterval(load, 30_000); // safety net if the feed is blocked
    const tick = setInterval(() => setNow(Date.now()), 20_000); // keep "12 min" honest
    return () => {
      es.close();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function move(t: Ticket, to: Status) {
    setBusy(t.id);
    // Move the card on screen immediately. The press must feel instant even on
    // shop wifi; the reload right after is what makes it true.
    setData((d) =>
      d ? { ...d, tickets: d.tickets.map((x) => (x.id === t.id ? { ...x, laneStatus: to, status: to } : x)) } : d,
    );
    try {
      await api(`/api/queue/${t.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: to, stationId: station || undefined }),
      });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
      load();
    }
  }

  const tickets = data?.tickets ?? [];
  const lanes = useMemo(
    () => ({
      todo: tickets.filter((t) => t.laneStatus === "waiting"),
      cooking: tickets.filter((t) => t.laneStatus === "preparing"),
      ready: tickets.filter((t) => t.laneStatus === "ready"),
      done: tickets.filter((t) => t.laneStatus === "completed"),
    }),
    [tickets],
  );

  function TicketCard({ t }: { t: Ticket }) {
    const action = ACTION[t.laneStatus];
    const waited = since(t.startedAt && t.laneStatus === "preparing" ? t.startedAt : t.createdAt, now);
    // Ten minutes on the line is the point where someone should look at it.
    const late = t.laneStatus !== "completed" && now - new Date(t.createdAt).getTime() > 10 * 60_000;
    const Icon = action?.icon;
    return (
      <div className={`card flex flex-col gap-3 p-4 ${late ? "ring-2 ring-amber-400" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold leading-none tracking-tight text-ink-900">{t.code}</div>
            <div className="mt-1 text-[11px] text-slate-400">{t.receiptNo}</div>
          </div>
          <div className={`flex items-center gap-1 text-xs font-semibold ${late ? "text-amber-600" : "text-slate-400"}`}>
            <Clock size={13} />
            {waited}
          </div>
        </div>

        <ul className="space-y-1">
          {t.items.length === 0 && <li className="text-sm text-slate-400">No items</li>}
          {t.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-900">
              <span className="min-w-[2rem] font-bold tabular-nums text-brand-700">{it.qty}×</span>
              <span className="flex-1">
                {it.name}
                {/* How the customer asked for it — spice level, sweetness.
                    Given real weight rather than tucked away as grey small
                    print: a cook who misses this makes the dish wrong, and the
                    whole order comes back. */}
                {it.note && (
                  <span className="mt-0.5 block rounded-md bg-amber-100 px-2 py-0.5 text-[13px] font-bold text-amber-900">
                    {it.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {/* Where each part is up to, but only when this screen watches more than
            one station — on a station's own screen it's just noise. */}
        {!station && t.jobs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {t.jobs.map((j) => (
              <span
                key={j.stationId}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  j.status === "ready" || j.status === "completed"
                    ? "bg-emerald-50 text-emerald-700"
                    : j.status === "preparing"
                      ? "bg-brand-50 text-brand-700"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {j.stationName}
              </span>
            ))}
          </div>
        )}

        {action ? (
          <button
            onClick={() => move(t, action.next)}
            disabled={busy === t.id}
            className={`flex h-14 items-center justify-center gap-2 rounded-lg text-base font-extrabold tracking-wide text-white transition disabled:opacity-50 ${action.className}`}
          >
            {Icon && <Icon size={18} />}
            {action.label}
          </button>
        ) : (
          <div className="flex h-14 items-center justify-center rounded-lg bg-slate-50 text-sm font-semibold text-slate-400">
            Collected
          </div>
        )}
      </div>
    );
  }

  function Lane({ title, sub, items, tone }: { title: string; sub: string; items: Ticket[]; tone: string }) {
    return (
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between border-b-2 pb-2" style={{ borderColor: tone }}>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-900">{title}</h2>
            <p className="text-[11px] text-slate-400">{sub}</p>
          </div>
          <span className="text-lg font-extrabold tabular-nums text-ink-900">{items.length}</span>
        </div>
        <div className="flex flex-col gap-3">
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
              Nothing here
            </p>
          ) : (
            items.map((t) => <TicketCard key={t.id} t={t} />)
          )}
        </div>
      </section>
    );
  }

  return (
    <div>
      <PageHeader
        title="Queue Management"
        subtitle="Every order paid for today. Press the button as each one moves along — the customer TVs follow instantly."
        actions={
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {live ? <Wifi size={13} /> : <WifiOff size={13} />}
            {live ? "Live" : "Reconnecting…"}
          </span>
        }
      />

      {/* Station picker: the same page becomes the Grill screen or the Drinks
          screen. Each kitchen opens it once and stays on its own tab. */}
      {(data?.stations.length ?? 0) > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Showing</span>
          {[{ id: "", name: "All orders" }, ...(data?.stations ?? [])].map((s) => (
            <button
              key={s.id || "all"}
              onClick={() => setStation(s.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                station === s.id ? "bg-ink-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <Spinner label="Loading today's orders…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ChefHat size={22} />}
            title="No orders yet today"
            hint="Orders appear here the moment a till takes payment — nothing to set up, and no need to refresh this page."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Lane title="New" sub="Paid, not started" items={lanes.todo} tone="#94a3b8" />
          <Lane title="Making" sub="In the kitchen now" items={lanes.cooking} tone="#2544c7" />
          <Lane title="Ready" sub="Called on the TV" items={lanes.ready} tone="#059669" />
        </div>
      )}

      {lanes.done.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Collected today · {lanes.done.length}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {lanes.done.map((t) => (
              <span key={t.id} className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
                {t.code}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 flex items-center gap-1.5 text-xs text-slate-400">
        <Monitor size={13} />
        Leave this page open on the kitchen tablet — it updates by itself and never needs refreshing.
      </p>
    </div>
  );
}
