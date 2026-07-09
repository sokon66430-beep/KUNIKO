import { NextResponse } from "next/server";
import { resetDB } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  await resetDB();
  return NextResponse.json({ ok: true });
}
