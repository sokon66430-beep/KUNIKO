"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import Sidebar from "./Sidebar";
import { ConfirmHost } from "./confirm";
import { ThemeProvider } from "./theme";
import { canAccessPage, isReadOnly } from "@/lib/access";
import { setViewOnly } from "@/lib/client";
import type { Role } from "@/lib/auth";

// The login page renders bare (no sidebar); everything else gets the app shell.
// The Suspense boundary lets pages use useSearchParams() (request-time data)
// without breaking the production build.
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [readOnly, setReadOnly] = useState(false);

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

  if (pathname === "/login" || pathname === "/register") return <Suspense>{children}</Suspense>;

  return (
    <ThemeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0 pt-[54px] lg:pt-0 lg:pl-[264px]">
          {readOnly && (
            <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">
              <Eye size={14} />
              View-only access (Management / Board) — you can see everything but can&apos;t make changes.
            </div>
          )}
          <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-10">
            <Suspense>{children}</Suspense>
          </div>
        </main>
        <ConfirmHost />
      </div>
    </ThemeProvider>
  );
}
