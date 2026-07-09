import { NextResponse } from "next/server";
import { khqrMode, markSimPaid } from "@/lib/bakong";

export const dynamic = "force-dynamic";

/**
 * SIM-mode only: marks a KHQR (by md5) as paid so the checkout flow can be
 * tested end-to-end without a live Bakong merchant account. Disabled in LIVE mode.
 */
export async function POST(req: Request) {
  if (khqrMode() !== "sim") {
    return NextResponse.json({ error: "Simulation is disabled in live mode" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body?.md5) {
    return NextResponse.json({ error: "md5 is required" }, { status: 400 });
  }
  markSimPaid(body.md5);
  return NextResponse.json({ ok: true });
}
