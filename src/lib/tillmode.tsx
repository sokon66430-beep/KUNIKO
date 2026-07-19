"use client";

// Till Mode — a per-DEVICE lock, not a per-person one. When a machine is put into
// Till Mode, WHOEVER signs in on it (any operation-team member, on their own
// login) sees ONLY the POS screen: no sidebar, no theme switch, no exports, no
// other pages. The same person on a back-office machine still gets the full app.
//
// The flag lives in this device's localStorage. Turning it on or off is gated by
// a manager code (see ManagerGate + /api/verify-manager) so store crew can't flip
// the till back into the full system themselves.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "stookii_till_mode";

type TillCtx = { tillMode: boolean; ready: boolean; setTillMode: (on: boolean) => void };
const Ctx = createContext<TillCtx>({ tillMode: false, ready: false, setTillMode: () => {} });

export function TillModeProvider({ children }: { children: ReactNode }) {
  const [tillMode, setTill] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTill(window.localStorage.getItem(KEY) === "1");
    setReady(true);
    // Keep other tabs on this device in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setTill(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setTillMode(on: boolean) {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
    setTill(on);
  }

  return <Ctx.Provider value={{ tillMode, ready, setTillMode }}>{children}</Ctx.Provider>;
}

export const useTillMode = () => useContext(Ctx);
