import type { DB, QueueTicket } from "./types";

// ---------------------------------------------------------------------------
// Centralized customer pickup-number queue.
//
// The number is issued by the SERVER inside a mutateDB transaction, never by a
// POS terminal. Because mutateDB serialises every write to a store's single
// JSON file, all 2–4 tills draw from one counter and can never collide on a
// number — the synchronisation is a property of the write-lock, not extra
// infrastructure. The counter is per store (one file per store).
//
// The display is three digits and wraps: 001, 002, … 099, then back to 001.
// This is only for calling the customer; the sale's invoiceNo and id remain the
// unique transaction identifiers.
// ---------------------------------------------------------------------------

export const QUEUE_MAX = 99;

/** 25 → "025". The customer-facing pickup number. */
export const formatQueue = (n: number): string => String(n).padStart(3, "0");

/**
 * Issue the next pickup number for this store, inside the caller's mutateDB.
 * Advances the shared counter (wrapping after 99) and records a ticket tied to
 * the sale. Returns the new ticket so the caller can put the number on the
 * receipt and the payment-complete screen.
 */
export function issueQueueTicket(
  db: DB,
  input: { saleId: string; receiptNo: string; posTerminalId?: string; cashier: string; at: string },
): QueueTicket {
  const current = db.meta.queue?.current ?? 0;
  const number = (current % QUEUE_MAX) + 1; // 1..99, wraps 99 → 1
  const ticket: QueueTicket = {
    id: `Q-${String(db.meta.nextQueueId++).padStart(6, "0")}`,
    number,
    saleId: input.saleId,
    receiptNo: input.receiptNo,
    posTerminalId: input.posTerminalId?.trim() || undefined,
    cashier: input.cashier,
    status: "waiting",
    createdAt: input.at,
  };
  db.meta.queue = { current: number, updatedAt: input.at };
  db.queue.push(ticket);
  return ticket;
}
