"use client";

import { usePathname } from "next/navigation";
import { ReactNode, Suspense } from "react";
import Sidebar from "./Sidebar";

// The login page renders bare (no sidebar); everything else gets the app shell.
// The Suspense boundary lets pages use useSearchParams() (request-time data)
// without breaking the production build.
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/register") return <Suspense>{children}</Suspense>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 pt-[57px] lg:pt-0 lg:pl-[264px]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Suspense>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}
