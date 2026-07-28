import type { DB, TillHolder } from "./types";

/**
 * One person, one till.
 *
 * Staff hand a till over by PIN all day, so the app knows who is on which
 * terminal. Letting the same person be signed in on two at once breaks the only
 * thing that record is for: when a drawer comes up short, or a void needs
 * explaining, "who was on this till" has to have exactly one answer.
 *
 * The hold is keyed by TERMINAL, not by person, which makes release automatic:
 * whoever signs in on a till takes it, and by taking it releases whoever held it
 * before.
 */

/**
 * How long a hold binds without being renewed.
 *
 * A till switched off at closing time never signs out, so its hold would stand
 * forever and lock that person out of every other till the next morning. Twelve
 * hours is longer than any single shift and shorter than the gap to the next
 * one, so a real overlap is caught and last night's ghost is not.
 */
export const HOLD_HOURS = 12;

export function isStale(h: TillHolder, now = Date.now()): boolean {
  const at = Date.parse(h.at);
  if (!Number.isFinite(at)) return true; // unparseable = not evidence of anything
  return now - at > HOLD_HOURS * 3600_000;
}

/** The live holds, with expired ones dropped. */
export function activeHolders(db: DB, now = Date.now()): TillHolder[] {
  return (db.meta.tillHolders || []).filter((h) => !isStale(h, now));
}

/**
 * The till this employee already holds, if it isn't `posTerminalId`.
 *
 * Returns undefined when they hold nothing, or when the only till they hold is
 * the one they are signing in to — signing in again on your own till is just a
 * re-entry, not a second session.
 */
export function heldElsewhere(
  db: DB,
  employeeId: string,
  posTerminalId: string,
  now = Date.now(),
): TillHolder | undefined {
  return activeHolders(db, now).find((h) => h.employeeId === employeeId && h.posTerminalId !== posTerminalId);
}

/**
 * Record that `employee` now holds `posTerminalId`, releasing both the previous
 * holder of that till and any other till this employee was on.
 *
 * The second part matters for the case the owner asked about in reverse: a
 * manager releases someone from POS 1 by signing in there themselves, and that
 * person must not stay bound to a till they no longer occupy.
 */
export function takeTill(
  db: DB,
  posTerminalId: string,
  employee: { id: string; name: string },
  at = new Date().toISOString(),
): void {
  const now = Date.parse(at) || Date.now();
  const kept = activeHolders(db, now).filter(
    (h) => h.posTerminalId !== posTerminalId && h.employeeId !== employee.id,
  );
  kept.push({ posTerminalId, employeeId: employee.id, employeeName: employee.name, at });
  db.meta.tillHolders = kept;
}

/** Release a till (sign-out), leaving every other hold alone. */
export function releaseTill(db: DB, posTerminalId: string): void {
  db.meta.tillHolders = activeHolders(db).filter((h) => h.posTerminalId !== posTerminalId);
}

/** Release whatever this employee holds — the owner's "free them up" action. */
export function releaseEmployee(db: DB, employeeId: string): void {
  db.meta.tillHolders = activeHolders(db).filter((h) => h.employeeId !== employeeId);
}
