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

export async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();
  if (viewOnly && method !== "GET" && method !== "HEAD" && !url.startsWith("/api/auth/")) {
    throw new Error("Management is a view-only account — changes are disabled.");
  }
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useFetch<T>(url: string): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;

    // `silent` = background refresh (no spinner flicker) so screens stay current.
    const load = (silent: boolean) => {
      if (!silent) setLoading(true);
      api<T>(url)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    };

    load(false);

    // Always show the latest data across users/devices: re-fetch whenever the
    // tab regains focus/visibility, plus a gentle poll while the tab is open.
    const refresh = () => {
      if (document.visibilityState === "visible") load(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 20000);

    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [url, tick]);

  return { data, loading, error, reload };
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
