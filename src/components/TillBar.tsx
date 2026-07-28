"use client";

// The slim top bar shown when a device is in Till Mode — it replaces the whole
// sidebar/header chrome. Shows the store, which till this is and the live shift
// status, plus a lock menu to log out (next person signs in) or leave Till Mode
// (manager code required).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogOut, Unlock, ChevronDown, CircleDot, UserRound, Delete, KeyRound, Sun, Moon, MonitorCog, Store } from "lucide-react";
import { useFetch } from "@/lib/client";
import { useTheme } from "@/components/theme";
import { useTillMode } from "@/lib/tillmode";
import { ManagerGate } from "@/components/ManagerGate";
import { Modal } from "@/components/ui";
import { PosShiftModal } from "@/components/PosShiftModal";
import { nextShiftName } from "@/components/shift";

type SessionInfo = {
  user: { name: string; storeName: string; storeId?: string; role?: string };
  // Every store this user may work in. On a till this is how the owner points
  // the device at the right shop — the sidebar's store switcher doesn't exist
  // here, because Till Mode has no sidebar.
  stores?: { id: string; name: string }[];
};
type BusinessInfo = { posTerminals?: string[] };
type ShiftsData = { shifts: { posTerminalId: string; status: string; shift: string; openedAt: string }[] };

export function TillBar() {
  const router = useRouter();
  const { setTillMode, kiosk } = useTillMode();
  const { theme, toggle } = useTheme();
  const { data: session } = useFetch<SessionInfo>("/api/auth/session");
  const { data: shiftData } = useFetch<ShiftsData>("/api/shifts");
  const { data: biz } = useFetch<BusinessInfo>("/api/business");
  // The tills this store runs, named once in Store Settings.
  const terminals = biz?.posTerminals?.length ? biz.posTerminals : ["POS 1", "POS 2", "POS 3"];

  const [terminal, setTerminal] = useState("POS 1");
  useEffect(() => {
    const saved = window.localStorage.getItem("stookii_pos_terminal");
    if (saved) setTerminal(saved);
  }, []);

  const allShifts = shiftData?.shifts || [];
  const openShift = allShifts.find((s) => s.posTerminalId === terminal && s.status === "open");
  // Which shift comes next on THIS till (A→B→C→A).
  //
  // Closing A does NOT open B by itself, and shouldn't: a shift starts by
  // counting its opening float, and starting one on an uncounted drawer would
  // make every over/short figure on that shift wrong. So the bar names the next
  // shift and opens the count in one tap — instead of saying "No shift" and
  // leaving the cashier to go looking for where to start it.
  const upNext = nextShiftName(allShifts as any, terminal);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [tillGate, setTillGate] = useState(false);
  const [tillPick, setTillPick] = useState(false);
  const [storeGate, setStoreGate] = useState(false);
  const [storePick, setStorePick] = useState(false);
  const [storeBusy, setStoreBusy] = useState(false);
  const stores = session?.stores || [];

  // Point this device at a shop. The store lives on the SESSION, so it carries
  // through every staff PIN hand-over afterwards (staff sign-in inherits the
  // device's store) — which is the whole working day. A full sign-out and a
  // fresh username login lands in that user's own store again.
  async function chooseStore(storeId: string) {
    setStoreBusy(true);
    try {
      const r = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not switch store");
      // Products, prices, shifts and the drawer all belong to the store, so
      // reload rather than leave half the till on the old one.
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
      setStoreBusy(false);
    }
  }

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
            <button
              onClick={() => setShiftOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
            >
              Open Shift {upNext}
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Dark / light switch — same control as the desktop sidebar, so the
              till screen can be flipped for day and night shifts. */}
          <button
            type="button"
            onClick={toggle}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-ink-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
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
              {/* Which till this device IS — OWNER ONLY, and not even shown to
                  anyone else. Every sale, drawer count and cash movement is
                  filed under this name, so changing it moves this device's money
                  onto another till's books. It is set once when the device is
                  installed; a cashier or a manager on shift never needs it, and
                  a control they can see is a control they will eventually try. */}
              {session?.user.role === "owner" && (
                <button
                  onClick={() => { setMenuOpen(false); setTillGate(true); }}
                  className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <MonitorCog size={16} className="text-slate-400" /> Set this till
                  <span className="ml-auto text-xs font-bold text-slate-400">{terminal}</span>
                </button>
              )}
              {/* Which SHOP this device sells for. Same owner-only gate as the
                  till, and for the same reason: it decides whose stock moves and
                  whose books the money lands in. Only offered when the owner
                  actually has more than one store to choose between. */}
              {session?.user.role === "owner" && stores.length > 1 && (
                <button
                  onClick={() => { setMenuOpen(false); setStoreGate(true); }}
                  className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Store size={16} className="text-slate-400" /> Set this store
                  <span className="ml-auto max-w-[7rem] truncate text-xs font-bold text-slate-400">
                    {session.user.storeName}
                  </span>
                </button>
              )}
              {/* A kiosk device is permanently a till — no exit, even for the
                  owner. And on any till, ONLY the owner even sees the exit:
                  staff signed into the POS can't leave Till Mode at all. */}
              {!kiosk && session?.user.role === "owner" && (
                <button
                  onClick={() => { setMenuOpen(false); setGate(true); }}
                  className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Unlock size={16} className="text-slate-400" /> Exit Till Mode
                </button>
              )}
            </div>
          )}
          </div>
        </div>
      </header>
      {shiftOpen && <PosShiftModal terminal={terminal} onClose={() => setShiftOpen(false)} />}

      {/* Manager code first, then the picker. Two steps on purpose: the code is
          what stops a cashier reassigning the till, and the picker is what stops
          them mistyping a name that doesn't exist. */}
      {tillGate && (
        <ManagerGate
          title="Set this till"
          hint="Which till is this device? Every sale and drawer count is filed under it, so only the owner can change it."
          actionLabel="Continue"
          // ownerOnly, to match who can even see the menu item. A manager code
          // must NOT open this: hiding the button from managers while still
          // accepting their code would be a lock with the key left in it.
          ownerOnly
          codeLabel="Owner password"
          onClose={() => setTillGate(false)}
          onOk={() => { setTillGate(false); setTillPick(true); }}
        />
      )}
      {tillPick && (
        <Modal open onClose={() => setTillPick(false)} title="Which till is this device?">
          <p className="mb-3 text-[13px] text-slate-500">
            Set this once when the device is installed. The list comes from Store Settings.
          </p>
          <div className="grid gap-2">
            {(terminals.includes(terminal) ? terminals : [terminal, ...terminals]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  window.localStorage.setItem("stookii_pos_terminal", t);
                  setTerminal(t);
                  setTillPick(false);
                  // Held orders, the open shift and the drawer are all keyed to
                  // the till, so reload rather than leave half the screen on the
                  // old one.
                  window.location.reload();
                }}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${
                  t === terminal
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-ink-900 hover:bg-slate-50"
                }`}
              >
                {t}
                {t === terminal && <span className="text-xs font-semibold text-brand-600">This device</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {storeGate && (
        <ManagerGate
          title="Set this store"
          hint="Which shop does this device sell for? Stock, prices and the money all belong to it, so only the owner can change it."
          actionLabel="Continue"
          ownerOnly
          codeLabel="Owner password"
          onClose={() => setStoreGate(false)}
          onOk={() => { setStoreGate(false); setStorePick(true); }}
        />
      )}
      {storePick && (
        <Modal open onClose={() => setStorePick(false)} title="Which shop is this device in?">
          <p className="mb-3 text-[13px] text-slate-500">
            Set this once when the device is installed. It stays put as staff hand the till over to each other.
          </p>
          <div className="grid gap-2">
            {stores.map((st) => {
              const current = st.id === session?.user.storeId;
              return (
                <button
                  key={st.id}
                  disabled={storeBusy}
                  onClick={() => (current ? setStorePick(false) : chooseStore(st.id))}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-bold transition disabled:opacity-50 ${
                    current
                      ? "border-brand-300 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-ink-900 hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0 truncate">{st.name}</span>
                  {current && <span className="shrink-0 text-xs font-semibold text-brand-600">This device</span>}
                </button>
              );
            })}
          </div>
        </Modal>
      )}

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
      // New session cookie is set. Refresh the till IN PLACE — do NOT reload the
      // whole page. A full reload re-downloads the entire catalogue and re-inits
      // everything, which is slow and unstable on the Sunmi kiosk WebView (it can
      // hang on "Loading products…"). Instead: refetch the session everywhere
      // (the bar shows the new staff name) and clear the POS cart for the new
      // person. Same store, same products — nothing else needs to reload.
      window.dispatchEvent(new Event("stookii-refetch"));
      window.dispatchEvent(new Event("stookii-staff-changed"));
      onClose();
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
