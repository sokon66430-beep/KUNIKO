import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const result = await mutateDB((db) => {
    const customer = db.customers.find((c) => c.id === params.id);
    if (!customer) return null;
    for (const key of ["name", "phone", "email"] as const) {
      if (key in body) (customer as any)[key] = body[key];
    }
    return customer;
  });

  if (!result) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = await mutateDB((db) => {
    const idx = db.customers.findIndex((c) => c.id === params.id);
    if (idx === -1) return false;
    db.customers.splice(idx, 1);
    return true;
  });

  if (!ok) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
