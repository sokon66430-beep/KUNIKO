import { readSystem } from "./system";
import { canSeeProfit } from "./access";
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
