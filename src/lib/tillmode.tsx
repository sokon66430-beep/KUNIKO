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
// Kiosk = a device PERMANENTLY locked to the till with no way out — not even the
// owner password. Set once by the Sunmi companion app (it loads Stookii with
// `?kiosk=1`, or injects window.__stookiiKiosk), then remembered on the device.
// A kiosk is always in Till Mode and setTillMode(false) is ignored.
const KIOSK_KEY = "stookii_kiosk";

type TillCtx = { tillMode: boolean; kiosk: boolean; ready: boolean; setTillMode: (on: boolean) => void };
const Ctx = createContext<TillCtx>({ tillMode: false, kiosk: false, ready: false, setTillMode: () => {} });

export function TillModeProvider({ children }: { children: ReactNode }) {
  const [tillMode, setTill] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let k = window.localStorage.getItem(KIOSK_KEY) === "1";
    try {
      const url = new URL(window.location.href);
      const kioskParam = url.searchParams.get("kiosk");
      if (kioskParam === "0") {
        // Owner escape hatch: unlock this device from kiosk. Only usable where the
        // URL is reachable (a normal browser) — the pinned Sunmi till has no
        // address bar, so a cashier can't do this.
        window.localStorage.removeItem(KIOSK_KEY);
        window.localStorage.removeItem(KEY);
        k = false;
      } else if (kioskParam === "1" || (window as unknown as { __stookiiKiosk?: boolean }).__stookiiKiosk) {
        window.localStorage.setItem(KIOSK_KEY, "1");
        k = true;
      }
    } catch {}
    setKiosk(k);
    setTill(k || window.localStorage.getItem(KEY) === "1");
    setReady(true);
    // Keep other tabs on this device in sync (a kiosk stays locked regardless).
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && !k) setTill(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setTillMode(on: boolean) {
    if (kiosk) return; // a kiosk device can never leave Till Mode
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
    setTill(on);
  }

  return <Ctx.Provider value={{ tillMode, kiosk, ready, setTillMode }}>{children}</Ctx.Provider>;
}

export const useTillMode = () => useContext(Ctx);
