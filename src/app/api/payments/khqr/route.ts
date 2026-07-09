import { NextResponse } from "next/server";
import { generateKhqr } from "@/lib/bakong";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
  }
  try {
    const khqr = await generateKhqr({
      amount,
      currency: body?.currency === "KHR" ? "KHR" : "USD",
      billNumber: body?.billNumber,
    });
    return NextResponse.json(khqr);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to generate KHQR" }, { status: 500 });
  }
}
