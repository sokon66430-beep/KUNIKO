"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "./auth";
import type { RoleCaps } from "./access";

// Mirrors the server-side write-block for view-only roles (Management / Board).
// Set once the session role is known (see useRole). Purely for UX — the real
// guarantee is the middleware block — so an edit control gives a clear message
// instead of a raw 403. Defaults to false, so a mutation attempted before the
// role loads is still caught server-side.
let viewOnly = false;
export function setViewOnly(v: boolean) {
  viewOnly = v;
}

// How long any one request may take before we give up on it.
//
// This is the difference between a till that recovers and a till that is dead.
// `fetch` has no timeout of its own: a socket the shop's wifi has silently
// dropped leaves the promise pending FOREVER, so a screen waiting on it shows
// its spinner forever too — the "always loading" the counter sees. Worse, the
// browser allows only ~6 connections per host, so a few hung requests wedge
// every other screen on the device as well. Aborting frees the socket.
const REQUEST_TIMEOUT = 12000;

export async function api<T = any>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();
  if (viewOnly && method !== "GET" && method !== "HEAD" && !url.startsWith("/api/auth/")) {
    throw new Error("Management is a view-only account — changes are disabled.");
  }
  const { timeoutMs = REQUEST_TIMEOUT, ...init } = options || {};
  // Respect a caller's own signal as well as our timeout: whichever fires first
  // aborts the request.
  const ctl = new AbortController();
  const onOuterAbort = () => ctl.abort();
  init.signal?.addEventListener("abort", onOuterAbort);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      cache: "no-store",
    });
  } catch (e: any) {
    // An abort we caused reads as a timeout; anything else is the network.
    if (e?.name === "AbortError" && !init.signal?.aborted) {
      throw new Error("The store took too long to respond. Check the connection.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onOuterAbort);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return readJson<T>(res);
}

/**
 * Read a JSON body, and say something useful when it isn't JSON.
 *
 * While the server restarts — a deploy, a crash, a cold start — the host answers
 * with its own HTML error page. `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE"... is not valid JSON`, which is what a
 * cashier was shown on the sign-in screen. It is the truth and it is useless.
 */
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (/^\s*</.test(text)) {
      throw new Error("The store is restarting — wait a moment and try again.");
    }
    throw new Error("The store sent something unreadable. Try again.");
  }
}

/** A poll's answer: fresh data, or "you already have it". */
export type Fetched<T> = { changed: true; data: T; etag: string | null } | { changed: false };

/**
 * GET that asks "has this changed?" before accepting the whole thing.
 *
 * Sends back the fingerprint the server gave us last time. If the data is
 * untouched the server answers 304 with no body, and the caller keeps what it
 * has — no download, no JSON parse, no re-render. That is what stops a till
 * pulling the whole 1.2 MB catalogue down every twenty seconds to discover
 * nothing changed. See lib/httpCache for the server half.
 *
 * `res.json()` is only ever called on a 200, because a 304 has no body to read.
 */
async function apiConditional<T>(url: string, etag: string | null): Promise<Fetched<T>> {
  const res = await rawGet(url, etag);
  if (res.status === 304) return { changed: false };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return { changed: true, data: await readJson<T>(res), etag: res.headers.get("etag") };
}

/** The bare GET behind apiConditional — same timeout/abort handling as api(). */
async function rawGet(url: string, etag: string | null): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
      // Our own revalidation, not the browser's: we hold the fingerprint and
      // decide, so the browser must not serve a cached copy behind our back.
      cache: "no-store",
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("The store took too long to respond. Check the connection.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// How long to wait before each retry of a failed load. A shop's wifi drops for a
// second or two at a time, so two quick goes recover almost every real blip
// without the cashier seeing anything.
const RETRY_DELAYS = [600, 2000];

// data / loading / error are ONE piece of state, set together. As three separate
// useStates they could disagree — "loading AND has data AND has an error" was
// reachable, and which of the three a screen happened to check decided what the
// cashier saw.
type FetchState<T> = { data: T | null; loading: boolean; error: string | null };

/**
 * How often a feed should be re-checked.
 *
 *  - "live"    — the default. Poll every 20s and on focus. For anything that
 *                changes while the shop trades: orders, the queue, shifts, the
 *                session, markdowns made at the till.
 *
 *  - "catalog" — load once when the till starts, refresh once overnight, and
 *                otherwise only when someone asks. For the product list, which
 *                is over a megabyte and changes when the office edits it, not
 *                while the counter is busy. Re-checking it 180 times an hour
 *                made the server read and fingerprint the whole catalogue every
 *                20 seconds, per till, to learn nothing.
 *
 * A till powered off at night reloads the catalogue when it starts next
 * morning, so the overnight window is a safety net for tills left running —
 * not the only way fresh prices arrive.
 */
export type RefreshPolicy = "live" | "catalog";

// The quiet hours a catalogue may refresh itself in — after close, before open.
const CATALOG_SYNC_FROM_HOUR = 2;
const CATALOG_SYNC_TO_HOUR = 4;
// How often a catalogue feed looks at the clock. No network — just a glance to
// see whether it is the middle of the night yet.
const CLOCK_CHECK_MS = 10 * 60_000;
// "Sync the catalogue now" — the manager's button, for a price that has to be
// right before tomorrow.
export const SYNC_CATALOG_EVENT = "stookii-sync-catalog";

export function syncCatalogNow() {
  window.dispatchEvent(new Event(SYNC_CATALOG_EVENT));
}

export function useFetch<T>(
  url: string,
  opts?: { policy?: RefreshPolicy },
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const policy: RefreshPolicy = opts?.policy ?? "live";
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    // Which request is the newest. A slow reply that lands after a newer one
    // must be dropped, or a stale basket/price can overwrite the current one —
    // responses arrive in whatever order the network feels like.
    let seq = 0;
    let haveData = false;
    // The fingerprint of the data we hold, handed back on the next poll so the
    // server can answer "unchanged" instead of resending it.
    let etag: string | null = null;
    const timers: number[] = [];

    const load = (silent: boolean, attempt = 0) => {
      const mine = ++seq;
      // The spinner is for the FIRST load only. Once a screen has data, a
      // refresh happens underneath it — a till that blanks to a spinner every
      // 20 seconds is unusable.
      if (!silent && !haveData) setState((s) => ({ ...s, loading: true, error: null }));
      apiConditional<T>(url, etag)
        .then((r) => {
          if (!alive || mine !== seq) return; // superseded by a newer request
          if (!r.changed) {
            // Nothing new. Deliberately no setState: an identical object would
            // still re-render every consumer of this hook, which on the POS
            // means rebuilding thousands of product tiles for no reason. Doing
            // nothing IS the optimisation.
            //
            // One exception: clear a stale error, so a screen that recovered
            // stops showing a warning about a failure that has passed.
            haveData = true;
            setState((s) => (s.loading || s.error ? { ...s, loading: false, error: null } : s));
            return;
          }
          haveData = true;
          etag = r.etag;
          setState({ data: r.data, loading: false, error: null });
        })
        .catch((e: any) => {
          if (!alive || mine !== seq) return;
          // Say so at the FIRST failure rather than after all the retries. A
          // till that sits on a spinner for another 30 seconds while we quietly
          // try again is the same bug, just slower — the cashier needs to know
          // now, with a customer in front of them.
          //
          // Existing data is kept: stale prices beat a blank till.
          setState((s) => ({ data: s.data, loading: false, error: e?.message || "Could not load" }));
          if (attempt < RETRY_DELAYS.length) {
            // Retries run SILENTLY underneath the message, so the screen doesn't
            // flicker between spinner and error. If one succeeds the error
            // clears and the data appears on its own.
            timers.push(window.setTimeout(() => load(true, attempt + 1), RETRY_DELAYS[attempt]));
          }
        });
    };

    load(false);

    // Always show the latest data across users/devices: re-fetch whenever the
    // tab regains focus/visibility, plus a gentle poll while the tab is open.
    const refresh = () => {
      if (document.visibilityState === "visible") load(true);
    };
    // A "refetch now" signal — used when the till swaps staff in place (no page
    // reload) so the new person's name shows immediately.
    //
    // SCOPED, via `detail.urls`. It used to refetch every hook on the page, and
    // on the POS that meant re-downloading the whole catalogue — over a
    // megabyte, thousands of products — every time one cashier handed the till
    // to the next. On a T3 the parse and re-render of that is a visible freeze,
    // and with several tills in the shop it is that much load on the server for
    // data that did not change: swapping who is signed in changes the SESSION,
    // not the products, the customers or the store's settings.
    //
    // A signal with no `urls` still refreshes everything, so any caller that
    // genuinely changed the store's data keeps working.
    const onRefetch = (e: Event) => {
      const only = (e as CustomEvent<{ urls?: string[] }>).detail?.urls;
      if (only && !only.some((u) => url.startsWith(u))) return;
      load(true);
    };
    window.addEventListener("stookii-refetch", onRefetch);

    // A catalogue is fetched once at startup and then left alone while the shop
    // trades. It refreshes on three things only: the manager's Sync button, the
    // overnight window, and an explicit scoped refetch.
    if (policy === "catalog") {
      const onSync = () => load(true);
      window.addEventListener(SYNC_CATALOG_EVENT, onSync);

      // Once per night, not once per check: `syncedOn` remembers the date we
      // last synced so a till left running through the window doesn't refetch
      // every ten minutes until 4am.
      let syncedOn = new Date().toDateString();
      const clock = window.setInterval(() => {
        const now = new Date();
        const today = now.toDateString();
        const h = now.getHours();
        if (today !== syncedOn && h >= CATALOG_SYNC_FROM_HOUR && h < CATALOG_SYNC_TO_HOUR) {
          syncedOn = today;
          load(true);
        }
      }, CLOCK_CHECK_MS);

      return () => {
        alive = false;
        for (const t of timers) window.clearTimeout(t);
        window.removeEventListener("stookii-refetch", onRefetch);
        window.removeEventListener(SYNC_CATALOG_EVENT, onSync);
        window.clearInterval(clock);
      };
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 20000);

    return () => {
      alive = false;
      for (const t of timers) window.clearTimeout(t);
      window.removeEventListener("stookii-refetch", onRefetch);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [url, tick, policy]);

  return { data: state.data, loading: state.loading, error: state.error, reload };
}

// Current user's role plus their capabilities, for screens that need to hide a
// widget rather than a whole page (e.g. profit figures) — full page-level
// gating lives in AppShell/Sidebar via canAccessPage instead.
//
// `caps` is empty until the session lands, which reads as "not decided" and so
// falls back to the baseline — never to "allowed" (see access.ts). Pair it with
// `role`, which is null while loading, and hold both from the same fetch: two
// hooks would mean two polls of the same endpoint that could disagree mid-flight.
export function useAccess(): { role: Role | null; caps: RoleCaps } {
  const { data } = useFetch<{ user: { role: Role }; caps?: RoleCaps }>("/api/auth/session");
  const role = data?.user.role ?? null;
  // Keep the client write-guard in sync with the signed-in role.
  if (role) setViewOnly(role === "management");
  return { role, caps: data?.caps ?? {} };
}

export function useRole(): Role | null {
  return useAccess().role;
}
