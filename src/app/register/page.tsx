"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Store, UserPlus, Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = storeName && username && password && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, name, username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create account");
      // Signed in already — go finish the store profile.
      router.push("/settings?welcome=1");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-brand-glow">
            <Store size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink-900">Create your store</h1>
          <p className="mt-1 text-sm text-slate-500">Set up a new store on Stookii</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <div>
            <label className="label">Store name</label>
            <input
              className="input"
              autoFocus
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="e.g. ON Mart TK 592"
            />
          </div>
          <div>
            <label className="label">Your name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sokha"
            />
          </div>
          <div>
            <label className="label">Username (to log in)</label>
            <input
              className="input"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="pick a username"
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
          <div>
            <label className="label">Confirm password</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className="btn-primary w-full" disabled={busy || !ready}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
            {busy ? "Creating…" : "Create store & account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
