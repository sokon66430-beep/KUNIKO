import { NextResponse } from "next/server";
import { checkKhqrPaid } from "@/lib/bakong";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const md5 = new URL(req.url).searchParams.get("md5");
  if (!md5) {
    return NextResponse.json({ error: "md5 is required" }, { status: 400 });
  }
  const status = await checkKhqrPaid(md5);
  return NextResponse.json(status);
}
