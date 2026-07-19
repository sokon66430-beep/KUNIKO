"use client";

import { useEffect } from "react";

// Registers the service worker so Stookii qualifies as an installable app.
// Runs once, silently — a failure just means no install prompt, never a crash.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
