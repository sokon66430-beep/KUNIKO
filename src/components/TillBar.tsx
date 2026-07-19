"use client";

// The slim top bar shown when a device is in Till Mode — it replaces the whole
// sidebar/header chrome. Shows the store, which till this is and the live shift
// status, plus a lock menu to log out (next person signs in) or leave Till Mode
// (manager code required).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogOut, Unlock, ChevronDown, CircleDot, UserRound, Delete, KeyRound } from "lucide-react";
import { useFetch } from "@/lib/client";
import { useTillMode } from "@/lib/tillmode";
import { ManagerGate } from "@/components/ManagerGate";
import { Modal } from "@/components/ui";

type SessionInfo = { user: { name: string; storeName: string } };
type ShiftsData = { shifts: { posTerminalId: string; status: string; shift: string }[] };

export function TillBar() {
  const router = useRouter();
  const { setTillMode } = useTillMode();
  const { data: session } = useFetch<SessionInfo>("/api/auth/session");
  const { data: shiftData } = useFetch<ShiftsData>("/api/shifts");

  const [terminal, setTerminal] = useState("POS 1");
  useEffect(() => {
    const saved = window.localStorage.getItem("stookii_pos_terminal");
    if (saved) setTerminal(saved);
  }, []);

  const openShift = (shiftData?.shifts || []).find((s) => s.posTerminalId === terminal && s.status === "open");

  // Live wall clock for the till header — refreshes every second.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dateLabel = now
    ? now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
    : "";
  const timeLabel = now
    ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "";

  const [menuOpen, setMenuOpen] = useState(false);
  const [gate, setGate] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-[52px] items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-extrabold text-white">S</span>
          <span className="truncate text-sm font-bold text-ink-900 dark:text-slate-100">{session?.user.storeName || "Stookii"}</span>
          <span className="hidden h-5 w-px bg-slate-200 sm:block dark:bg-slate-700" />
          <span className="hidden shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 sm:inline dark:bg-slate-800 dark:text-slate-300">
            Till {terminal}
          </span>
          {openShift ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              <CircleDot size={12} /> Shift {openShift.shift}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              No shift
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-right sm:flex dark:bg-slate-800/60">
            <div className="leading-tight">
              <div className="text-xs font-bold tabular-nums text-ink-900 dark:text-slate-100">{timeLabel}</div>
              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{dateLabel}</div>
            </div>
          </div>

          <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Lock size={16} /> <span className="hidden sm:inline">{session?.user.name || "Till"}</span> <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lift dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => { setMenuOpen(false); setStaffOpen(true); }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <UserRound size={16} className="text-slate-400" /> Switch staff
              </button>
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut size={16} className="text-slate-400" /> Log out
              </button>
              <button
                onClick={() => { setMenuOpen(false); setGate(true); }}
                className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Unlock size={16} className="text-slate-400" /> Exit Till Mode
              </button>
            </div>
          )}
          </div>
        </div>
      </header>

      {gate && (
        <ManagerGate
          title="Exit Till Mode"
          hint="Only the owner can turn this device back into the full system. Enter the owner password."
          actionLabel="Exit Till Mode"
          ownerOnly
          codeLabel="Owner password"
          onClose={() => setGate(false)}
          onOk={() => { setGate(false); setTillMode(false); router.push("/"); }}
        />
      )}

      {staffOpen && <StaffSignIn onClose={() => setStaffOpen(false)} />}
    </>
  );
}

// Till staff sign-in — pick your name, type your PIN, take over the till. Backed
// by the current store's Job Schedule roster (only staff with a PIN show up).
type StaffLite = { id: string; name: string; hasPin?: boolean; active?: boolean; positionId?: string };

function StaffSignIn({ onClose }: { onClose: () => void }) {
  const { data } = useFetch<{ employees: StaffLite[]; positions: { id: string; name: string }[] }>("/api/schedule");
  const staff = (data?.employees || []).filter((e) => e.hasPin && e.active !== false);
  const posName = (id?: string) => (data?.positions || []).find((p) => p.id === id)?.name;

  const [sel, setSel] = useState<StaffLite | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!sel || pin.length !== 6) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: sel.id, pin }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Sign-in failed");
      }
      // New session cookie is set — reload so the whole till runs as this staff.
      window.location.reload();
    } catch (e: any) {
      setErr(e.message);
      setPin("");
      setBusy(false);
    }
  }

  const key = (d: string) => setPin((p) => (p.length >= 6 ? p : p + d));

  return (
    <Modal open onClose={onClose} title="Staff sign-in" size="md">
      {!sel ? (
        <div>
          <p className="mb-3 text-sm text-slate-500">Pick your name to sign into the till.</p>
          {staff.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
              No staff have a POS PIN yet. Set one in Job Schedule → Employees.
            </div>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
              {staff.map((e) => (
                <button
                  key={e.id}
                  onClick={() => { setSel(e); setPin(""); setErr(""); }}
                  className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                    {e.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-ink-900">{e.name}</span>
                    {posName(e.positionId) && <span className="block truncate text-xs text-slate-400">{posName(e.positionId)}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <button onClick={() => { setSel(null); setPin(""); setErr(""); }} className="mb-3 text-xs font-semibold text-slate-400 hover:text-slate-600">
            ‹ Choose a different name
          </button>
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-base font-bold text-brand-700">
              {sel.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="text-sm font-bold text-ink-900">{sel.name}</p>
              <p className="text-xs text-slate-400">Enter your PIN</p>
            </div>
          </div>

          {/* PIN dots */}
          <div className="mb-3 flex justify-center gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? "bg-brand-600" : "bg-slate-200"}`} />
            ))}
          </div>
          {err && <p className="mb-3 text-center text-sm font-semibold text-rose-600">{err}</p>}

          {/* Keypad */}
          <div className="mx-auto grid max-w-[240px] grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} onClick={() => key(d)} className="rounded-xl bg-slate-100 py-3 text-lg font-bold text-ink-900 transition hover:bg-slate-200 active:scale-95">
                {d}
              </button>
            ))}
            <button onClick={() => setPin("")} className="rounded-xl py-3 text-sm font-semibold text-slate-400 transition hover:bg-slate-100">
              Clear
            </button>
            <button onClick={() => key("0")} className="rounded-xl bg-slate-100 py-3 text-lg font-bold text-ink-900 transition hover:bg-slate-200 active:scale-95">
              0
            </button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} className="grid place-items-center rounded-xl py-3 text-slate-400 transition hover:bg-slate-100">
              <Delete size={20} />
            </button>
          </div>

          <button
            onClick={submit}
            disabled={busy || pin.length !== 6}
            className="btn-primary mt-4 w-full justify-center"
          >
            <KeyRound size={16} /> {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      )}
    </Modal>
  );
}
