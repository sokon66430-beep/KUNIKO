"use client";

// The slim top bar shown when a device is in Till Mode — it replaces the whole
// sidebar/header chrome. Shows the store, which till this is and the live shift
// status, plus a lock menu to log out (next person signs in) or leave Till Mode
// (manager code required).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogOut, Unlock, ChevronDown, CircleDot } from "lucide-react";
import { useFetch } from "@/lib/client";
import { useTillMode } from "@/lib/tillmode";
import { ManagerGate } from "@/components/ManagerGate";

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

  const [menuOpen, setMenuOpen] = useState(false);
  const [gate, setGate] = useState(false);
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
                onClick={() => { setMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
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
      </header>

      {gate && (
        <ManagerGate
          title="Exit Till Mode"
          hint="A manager code is needed to turn this device back into the full system."
          actionLabel="Exit Till Mode"
          onClose={() => setGate(false)}
          onOk={() => { setGate(false); setTillMode(false); router.push("/"); }}
        />
      )}
    </>
  );
}
