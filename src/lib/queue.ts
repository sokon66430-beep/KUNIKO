import type { DB, KitchenStation, QueueEvent, QueueStationJob, QueueStatus, QueueTicket, SaleItem } from "./types";
import { storeToday } from "./storetime";

// ---------------------------------------------------------------------------
// Centralized customer pickup-number queue.
//
// The number is issued by the SERVER inside a mutateDB transaction, never by a
// POS terminal. Because mutateDB serialises every write to a store's single
// document, all tills draw from one counter and can never collide on a number —
// the synchronisation is a property of the write-lock, not extra
// infrastructure. Read-modify-write of the counter happens wholly inside that
// lock, which is what makes "POS 1, 2 and 3 pay at the same instant" safe.
// The counter is per store, so Phnom Penh and Siem Reap both run their own A001.
//
// Numbers run in LETTER BLOCKS: A001…A099, then B001…B099, then C001… After Z
// it wraps to A. The block resets to A001 on the store's next business day
// (Asia/Phnom_Penh), so a customer never sees yesterday's number.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_PER_LETTER = 99;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 25 → "025". The numeric half of the pickup number. */
export const formatQueue = (n: number): string => String(n).padStart(3, "0");

/**
 * The customer-facing code: "A001".
 *
 * Falls back to the bare number for tickets issued before letters existed, so
 * old receipts and the queue history still read correctly.
 */
export function formatQueueCode(t: Pick<QueueTicket, "number" | "letter" | "code">): string {
  if (t.code) return t.code;
  return `${t.letter ?? ""}${formatQueue(t.number)}`;
}

/** The letter after this one, wrapping Z → A. */
function nextLetter(letter: string): string {
  const i = LETTERS.indexOf(letter);
  return LETTERS[(i < 0 ? 0 : i + 1) % LETTERS.length];
}

/**
 * Work out the next code for this store, applying the daily reset.
 *
 * Split out from issueQueueTicket so it can be unit-tested and so the admin
 * screen can preview "the next number will be B014" without issuing one.
 */
export function nextQueueCode(
  prev: { current: number; letter?: string; day?: string } | undefined,
  today: string,
  maxPerLetter = DEFAULT_MAX_PER_LETTER,
  resetDaily = true,
): { number: number; letter: string } {
  const cap = Math.max(1, Math.floor(maxPerLetter) || DEFAULT_MAX_PER_LETTER);
  // A new business day starts the whole sequence again at A001. A store file
  // written before `day` was recorded has no day, which reads as "reset" — the
  // safe direction, since restarting at A001 can never collide with a live
  // ticket the way continuing a stale count could.
  const staleDay = resetDaily && prev?.day !== today;
  if (!prev || staleDay) return { number: 1, letter: "A" };

  const letter = prev.letter || "A";
  if (prev.current >= cap) return { number: 1, letter: nextLetter(letter) };
  return { number: prev.current + 1, letter };
}

/**
 * Split a paid order into one job per kitchen station.
 *
 * Only items whose product carries a stationId reach a kitchen — a bottle of
 * water on the same receipt is simply not in any job. An order with nothing
 * routed produces no jobs at all, which is what a plain retail basket that just
 * wants a pickup number should do.
 */
export function buildStationJobs(
  items: SaleItem[],
  productStation: Map<string, string>,
  stations: KitchenStation[],
): QueueStationJob[] {
  const byStation = new Map<string, QueueStationJob>();
  for (const it of items) {
    const stationId = productStation.get(it.productId);
    if (!stationId) continue;
    const station = stations.find((s) => s.id === stationId);
    // A station that was deleted after the product was linked shouldn't strand
    // the item silently — skip routing rather than invent a lane nobody watches.
    if (!station || !station.active) continue;
    let job = byStation.get(stationId);
    if (!job) {
      job = {
        stationId,
        // Snapshot the name: renaming "Fry" to "Fryer" next month must not
        // rewrite what last week's tickets said.
        stationName: station.name,
        items: [],
        status: "waiting",
      };
      byStation.set(stationId, job);
    }
    job.items.push({ name: it.name, qty: it.qty });
  }
  return [...byStation.values()];
}

/**
 * Issue the next pickup number for this store, inside the caller's mutateDB.
 *
 * Advances the shared counter and records a ticket tied to the sale. Returns
 * the ticket so the caller can put the code on the receipt and the
 * payment-complete screen.
 */
export function issueQueueTicket(
  db: DB,
  input: {
    saleId: string;
    receiptNo: string;
    posTerminalId?: string;
    cashier: string;
    at: string;
    items?: SaleItem[];
  },
): QueueTicket {
  const cfg = db.meta.business.queueSettings || {};
  const today = storeToday(new Date(input.at));
  const { number, letter } = nextQueueCode(db.meta.queue, today, cfg.maxPerLetter, cfg.resetDaily !== false);

  const stations = db.kitchenStations || [];
  const productStation = new Map<string, string>();
  for (const p of db.products) if (p.stationId) productStation.set(p.id, p.stationId);
  const jobs = input.items ? buildStationJobs(input.items, productStation, stations) : [];

  const firstEvent: QueueEvent = {
    at: input.at,
    status: "waiting",
    by: input.cashier,
    device: input.posTerminalId?.trim() || undefined,
  };

  const ticket: QueueTicket = {
    id: `Q-${String(db.meta.nextQueueId++).padStart(6, "0")}`,
    number,
    letter,
    code: `${letter}${formatQueue(number)}`,
    day: today,
    saleId: input.saleId,
    receiptNo: input.receiptNo,
    posTerminalId: input.posTerminalId?.trim() || undefined,
    cashier: input.cashier,
    status: "waiting",
    jobs: jobs.length ? jobs : undefined,
    events: [firstEvent],
    createdAt: input.at,
  };
  db.meta.queue = { current: number, letter, day: today, updatedAt: input.at };
  db.queue.push(ticket);
  return ticket;
}

/** Legal next states, so a stray double-tap on the KDS can't move a ticket backwards. */
const NEXT: Record<QueueStatus, QueueStatus[]> = {
  waiting: ["preparing", "ready", "completed", "cancelled"],
  preparing: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canAdvance(from: QueueStatus, to: QueueStatus): boolean {
  return (NEXT[from] || []).includes(to);
}

/**
 * Move a ticket (or one station's lane of it) to a new status, recording who
 * did it, when, and from which device.
 *
 * When every station lane is ready, the ticket itself becomes ready — that is
 * what puts the number on the customer TV, so it must not depend on anyone
 * remembering to press a second button.
 */
export function advanceTicket(
  ticket: QueueTicket,
  to: QueueStatus,
  who: { by: string; device?: string; stationId?: string },
  at: string,
): { ok: true } | { ok: false; error: string } {
  if (who.stationId) {
    const job = (ticket.jobs || []).find((j) => j.stationId === who.stationId);
    if (!job) return { ok: false, error: "That station has nothing on this ticket" };
    if (!canAdvance(job.status, to)) return { ok: false, error: `Can't go from ${job.status} to ${to}` };
    job.status = to;
    if (to === "preparing") job.startedAt = at;
    if (to === "ready") job.readyAt = at;
  } else {
    if (!canAdvance(ticket.status, to)) return { ok: false, error: `Can't go from ${ticket.status} to ${to}` };
  }

  const jobs = ticket.jobs || [];
  const live = jobs.filter((j) => j.status !== "cancelled");
  // Roll the ticket up from its lanes: it is only "ready" once every lane is,
  // and "preparing" as soon as any lane has started.
  let rolled: QueueStatus = ticket.status;
  if (who.stationId && live.length) {
    if (live.every((j) => j.status === "completed")) rolled = "completed";
    else if (live.every((j) => j.status === "ready" || j.status === "completed")) rolled = "ready";
    else if (live.some((j) => j.status !== "waiting")) rolled = "preparing";
  } else if (!who.stationId) {
    rolled = to;
    // Driving the whole ticket carries its lanes with it, so a lane can't be
    // left behind saying "preparing" on a ticket that has been handed over.
    for (const j of live) if (canAdvance(j.status, to)) j.status = to;
  }

  ticket.status = rolled;
  if (rolled === "preparing" && !ticket.startedAt) ticket.startedAt = at;
  if (rolled === "ready" && !ticket.readyAt) ticket.readyAt = at;
  if (rolled === "completed" && !ticket.completedAt) ticket.completedAt = at;
  if (rolled === "cancelled") {
    ticket.cancelledAt = at;
    ticket.cancelledBy = who.by;
  }

  (ticket.events ||= []).push({ at, status: to, by: who.by, device: who.device, stationId: who.stationId });
  return { ok: true };
}
