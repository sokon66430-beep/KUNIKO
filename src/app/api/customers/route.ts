import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import type { Customer } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  const sorted = [...db.customers].sort((a, b) => b.totalSpent - a.totalSpent);
  return NextResponse.json(sorted);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const created = await mutateDB((db) => {
    const idNum = db.customers.reduce((max, c) => Math.max(max, parseInt(c.id.slice(1)) || 0), 0) + 1;
    const customer: Customer = {
      id: `c${idNum.toString().padStart(3, "0")}`,
      name: body.name.trim(),
      phone: body.phone?.trim() || "",
      email: body.email?.trim() || undefined,
      loyaltyPoints: 0,
      totalSpent: 0,
      visits: 0,
      tier: "Bronze",
      createdAt: new Date().toISOString(),
    };
    db.customers.push(customer);
    return customer;
  });

  return NextResponse.json(created, { status: 201 });
}
