"use client";

import { useMemo, useState } from "react";
import { Search, X, ListOrdered, RotateCcw, Ban, Ticket } from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { confirmDialog } from "@/components/confirm";
import { PageHeader, Card, Spinner, ErrorBox, Badge, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { dateTime, timeOnly } from "@/lib/format";
import { formatQueue } from "@/lib/queue";
import { canManageQueue } from "@/lib/access";

type TicketView = {
  id: string;
  number: number;
  receiptNo: string;
  posTerminalId: string | null;
  cashier: string;
  status: "waiting" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
  total: number | null;
  items: { name: string; qty: number }[];
};
type QueueData = { current: number; updatedAt: string | null; recent: TicketView[] };
type SearchData = { query: string; matches: TicketView[] };

// Pickup-number board: the current number, a search for the operation team, and
// (for supervisors) reset + cancel. Cashiers issue numbers at the till; this
// page is where anyone looks one up or a supervisor fixes a mistake.
export default function QueuePage() {
  const role = useRole();
  const isSupervisor = role ? canManageQueue(role) : false;
  const { data, loading, error, reload } = useFetch<QueueData>("/api/queue");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<SearchData | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const cleaned = useMemo(() => term.replace(/\D/g, ""), [term]);

  async function runSearch() {
    if (!cleaned) return;
    setSearching(true);
    try {
      setSearch(await api<SearchData>(`/api/queue?number=${cleaned}`));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setTerm("");
    setSearch(null);
  }

  async function resetCounter() {
    if (
      !(await confirmDialog({
        title: "Reset pickup counter",
        message: "Start the pickup numbers again from 001? Numbers already given out stay on record; only the counter rewinds.",
        confirmText: "Reset to 001",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    try {
      await api("/api/queue/reset", { method: "POST" });
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTicket(t: TicketView) {
    if (
      !(await confirmDialog({
        title: `Cancel number ${formatQueue(t.number)}`,
        message: `Void pickup number ${formatQueue(t.number)} (receipt ${t.receiptNo})? The sale is untouched — only the pickup number is cancelled.`,
        confirmText: "Cancel number",
        tone: "danger",
      }))
    )
      return;
    try {
      await api(`/api/queue/${t.id}/cancel`, { method: "POST" });
      reload();
      if (search) runSearch();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function ticketRows(list: TicketView[]) {
    return list.map((t) => (
      <Tr key={t.id}>
        <Td>
          <span className={`text-lg font-extrabold tabular-nums ${t.status === "cancelled" ? "text-slate-400 line-through" : "text-ink-900"}`}>
            {formatQueue(t.number)}
          </span>
        </Td>
        <Td className="text-slate-500">{t.receiptNo}</Td>
        <Td>
          {t.items.length ? (
            <span className="text-slate-700">{t.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </Td>
        <Td className="whitespace-nowrap text-slate-500">{t.posTerminalId || "—"}</Td>
        <Td className="whitespace-nowrap text-slate-500">{timeOnly(t.createdAt)}</Td>
        <Td>
          {t.status === "cancelled" ? <Badge tone="rose">Cancelled</Badge> : <Badge tone="emerald">Waiting</Badge>}
        </Td>
        {isSupervisor && (
          <Td align="right">
            {t.status === "waiting" && (
              <button
                onClick={() => cancelTicket(t)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Ban size={13} /> Cancel
              </button>
            )}
          </Td>
        )}
      </Tr>
    ));
  }

  return (
    <div>
      <PageHeader
        title="Pickup Queue"
        subtitle="Customer pickup numbers — one shared sequence across every POS terminal"
        actions={
          isSupervisor ? (
            <button className="btn-ghost" disabled={busy} onClick={resetCounter} title="Rewind the counter to 001">
              <RotateCcw size={16} /> Reset counter
            </button>
          ) : undefined
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Current number */}
        <Card className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Now serving up to</p>
          <p className="my-1 text-6xl font-extrabold tabular-nums text-brand-600">
            {data ? formatQueue(data.current || 0) : "—"}
          </p>
          <p className="text-[11px] text-slate-400">
            {data?.updatedAt ? `Updated ${dateTime(data.updatedAt)}` : "No numbers issued yet"}
          </p>
        </Card>

        {/* Search */}
        <Card>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800">
            <Search size={15} /> Look up a pickup number
          </p>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <Ticket size={15} className="shrink-0 text-slate-400" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="e.g. 025"
                inputMode="numeric"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
              {term && (
                <button onClick={clearSearch} className="shrink-0 text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <button className="btn-primary !py-2" disabled={!cleaned || searching} onClick={runSearch}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {search && (
            <div className="mt-3">
              {search.matches.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  No pickup number {formatQueue(Number(cleaned) || 0)} on record.
                </p>
              ) : (
                <Table>
                  <THead>
                    <Th>No.</Th>
                    <Th>Receipt</Th>
                    <Th>Items</Th>
                    <Th>Terminal</Th>
                    <Th>Time</Th>
                    <Th>Status</Th>
                    {isSupervisor && <Th align="right"></Th>}
                  </THead>
                  <TBody>{ticketRows(search.matches)}</TBody>
                </Table>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Recent numbers */}
      {loading && !data ? (
        <Spinner label="Loading queue…" />
      ) : !data || data.recent.length === 0 ? (
        <Card>
          <EmptyState
            title="No pickup numbers yet"
            hint="At the till, turn on “Pickup number” before taking payment and the customer gets the next number."
            icon={<ListOrdered size={18} />}
          />
        </Card>
      ) : (
        <Card title="Recent numbers" subtitle="Newest first">
          <Table>
            <THead>
              <Th>No.</Th>
              <Th>Receipt</Th>
              <Th>Items</Th>
              <Th>Terminal</Th>
              <Th>Time</Th>
              <Th>Status</Th>
              {isSupervisor && <Th align="right"></Th>}
            </THead>
            <TBody>{ticketRows(data.recent)}</TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
