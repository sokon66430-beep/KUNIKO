"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Public sign-up is disabled — send anyone who lands here back to the login.
export const dynamic = "force-dynamic";

export default function RegisterDisabled() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
