"use client";

import { useCallback, useEffect, useState } from "react";

export async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
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
