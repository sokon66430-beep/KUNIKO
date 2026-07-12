"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect } from "react";
import Sidebar from "./Sidebar";
import { ConfirmHost } from "./confirm";
import { ThemeProvider } from "./theme";
import { canAccessPage } from "@/lib/access";
import type { Role } from "@/lib/auth";

// The login page renders bare (no sidebar); everything else gets the app shell.
// The Suspense boundary lets pages use useSearchParams() (request-time data)
// without breaking the production build.
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Re-check page access on every navigation so an owner-set denial (beyond
  // the built-in baseline middleware already enforces) still sends the user
  // back to their dashboard, even for a client-side <Link> transition.
  useEffect(() => {
    if (pathname === "/login" || pathname === "/register") return;
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive || !s) return;
        const role = s.user.role as Role;
        if (!canAccessPage(role, pathname, s.denied)) router.replace("/");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, router]);

  if (pathname === "/login" || pathname === "/register") return <Suspense>{children}</Suspense>;

  return (
    <ThemeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0 pt-[57px] lg:pt-0 lg:pl-[264px]">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
            <Suspense>{children}</Suspense>
          </div>
        </main>
        <ConfirmHost />
      </div>
    </ThemeProvider>
  );
}
