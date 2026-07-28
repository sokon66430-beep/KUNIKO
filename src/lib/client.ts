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
  return res.json();
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

export function useFetch<T>(url: string): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
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
    const timers: number[] = [];

    const load = (silent: boolean, attempt = 0) => {
      const mine = ++seq;
      // The spinner is for the FIRST load only. Once a screen has data, a
      // refresh happens underneath it — a till that blanks to a spinner every
      // 20 seconds is unusable.
      if (!silent && !haveData) setState((s) => ({ ...s, loading: true, error: null }));
      api<T>(url)
        .then((d) => {
          if (!alive || mine !== seq) return; // superseded by a newer request
          haveData = true;
          setState({ data: d, loading: false, error: null });
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
    // A global "refetch now" signal — used when the till swaps staff in place
    // (no page reload) so the session/name and any data refresh immediately.
    const onRefetch = () => load(true);
    window.addEventListener("stookii-refetch", onRefetch);
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
  }, [url, tick]);

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
