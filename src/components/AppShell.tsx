"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import Sidebar from "./Sidebar";
import { TillBar } from "./TillBar";
import { ConfirmHost } from "./confirm";
import { ThemeProvider } from "./theme";
import { TillModeProvider, useTillMode } from "@/lib/tillmode";
import { canAccessPage, isReadOnly } from "@/lib/access";
import { setViewOnly } from "@/lib/client";
import type { Role } from "@/lib/auth";

// Pages a locked till may show: the POS itself and the read-only Money
// Management page (drawer/safe/reports). Everything else bounces back to /pos.
const TILL_PATHS = ["/pos", "/money"];

// The login page renders bare (no sidebar); everything else gets the app shell.
// The Suspense boundary lets pages use useSearchParams() (request-time data)
// without breaking the production build.
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TillModeProvider>
        <ShellInner>{children}</ShellInner>
      </TillModeProvider>
    </ThemeProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [readOnly, setReadOnly] = useState(false);
  const { tillMode, ready } = useTillMode();

  // Re-check page access on every navigation so an owner-set denial (beyond
  // the built-in baseline middleware already enforces) still sends the user
  // back to their dashboard, even for a client-side <Link> transition.
  useEffect(() => {
    if (pathname === "/login" || pathname === "/register" || pathname === "/customer-display") return;
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive || !s) return;
        const role = s.user.role as Role;
        // Sync the client write-guard + banner with the signed-in role.
        const ro = isReadOnly(role);
        setViewOnly(ro);
        setReadOnly(ro);
        if (!canAccessPage(role, pathname, s.denied)) router.replace("/");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, router]);

  // Till Mode: this DEVICE is a cash register — confine it to the POS screen (and
  // the read-only Money Management page) no matter who signs in or what URL they
  // try.
  useEffect(() => {
    if (!ready || !tillMode) return;
    if (pathname === "/login" || pathname === "/register" || pathname === "/customer-display") return;
    if (!TILL_PATHS.includes(pathname)) router.replace("/pos");
  }, [ready, tillMode, pathname, router]);

  // On a till the screen is PINNED — lock the page so it can't be scrolled or
  // dragged up/down/left/right (a real cash register doesn't pan). Inner panels
  // still scroll on their own if content is taller than the screen.
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.classList.toggle("till-locked", tillMode);
    return () => root.classList.remove("till-locked");
  }, [ready, tillMode]);

  if (pathname === "/login" || pathname === "/register") return <Suspense>{children}</Suspense>;

  // The customer-facing second screen (Sunmi T3) is chrome-free: no sidebar, no
  // till bar — it only mirrors the sale for the customer to watch.
  if (pathname === "/customer-display") return <Suspense>{children}</Suspense>;

  // Locked till: slim bar, no sidebar, POS only. While a stray URL is being
  // bounced back to /pos, render nothing so the wrong page never flashes.
  if (ready && tillMode) {
    return (
      <>
        <TillBar />
        {/* Fixed frame under the till bar — the screen never pans; only the
            content inside scrolls, and only if it's taller than the screen. */}
        <main className="fixed inset-x-0 bottom-0 top-[52px] overflow-hidden">
          {/* The POS fits the fixed frame (its product list scrolls inside its own
              column); Money Management is a normal page, so the frame scrolls for
              it. Either way the page itself stays pinned. */}
          <div className={`mx-auto flex h-full flex-col overflow-y-auto overscroll-contain px-3 py-3 sm:px-6 lg:px-10 ${pathname === "/pos" ? "max-w-none lg:overflow-hidden" : "max-w-6xl"}`}>
            {TILL_PATHS.includes(pathname) ? <Suspense>{children}</Suspense> : null}
          </div>
        </main>
        <ConfirmHost />
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 pt-[54px] lg:pt-0 lg:pl-[264px]">
        {readOnly && (
          <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">
            <Eye size={14} />
            View-only access (Management / Board) — you can see everything but can&apos;t make changes.
          </div>
        )}
        <div className={`mx-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-10 ${pathname === "/pos" ? "max-w-none" : "max-w-6xl"}`}>
          <Suspense>{children}</Suspense>
        </div>
      </main>
      <ConfirmHost />
    </div>
  );
}
