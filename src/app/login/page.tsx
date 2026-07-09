"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Store, LogIn, Loader2 } from "lucide-react";

// Reads ?next= via useSearchParams — render at request time, not at build.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Sign in failed");
      const next = params.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-brand-glow">
            <Store size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink-900">Stookii</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your store</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              autoFocus
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="owner"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className="btn-primary w-full" disabled={busy || !username || !password}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          New store?{" "}
          <Link href="/register" className="font-semibold text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-slate-400">Stookii · Retail Ordering</p>
      </div>
    </div>
  );
}
