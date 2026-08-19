import { readSystem } from "./system";
import { canAcceptCosts, canSeeProfit, canUseMasterData } from "./access";
import type { Role } from "./auth";

// Server-side resolution of a capability against the owner's live config.
//
// Kept out of access.ts on purpose: that module is imported by middleware and
// must stay edge-safe (type-only imports, no fs), so it can't read system.json
// itself. Route handlers run in Node and can.

/**
 * May this role see profit, margin and cost right now?
 *
 * Callers keep their own handling of a missing session — the routes disagree on
 * what an unauthenticated request should see, and that's not this function's
 * call to make.
 */
export async function profitFor(role: Role): Promise<boolean> {
  const sys = await readSystem();
  return canSeeProfit(role, sys.roleCaps?.[role]);
}

/**
 * May this role open and edit the company-wide Master Data right now?
 * Owner always; anyone else only when the owner granted it on /permissions.
 */
export async function masterDataFor(role: Role): Promise<boolean> {
  const sys = await readSystem();
  return canUseMasterData(role, sys.roleCaps?.[role]);
}

/**
 * May this role turn an invoiced cost into the product's cost right now?
 *
 * Its own capability so Procurement can be given the cost without being given
 * the catalogue — and Master Data includes it, because anybody who can type
 * any cost into any product is not protected by being refused this one.
 */
export async function acceptCostsFor(role: Role): Promise<boolean> {
  const sys = await readSystem();
  return canAcceptCosts(role, sys.roleCaps?.[role]);
}
