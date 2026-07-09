import { NextResponse } from "next/server";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { PurchaseRequest, PRItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDB();
  const list = [...db.purchaseRequests].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const body = await req.json();
  const items: PRItem[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
  }

  const created = await mutateDB((db) => {
    const n = db.meta.nextPR++;
    const pr: PurchaseRequest = {
      id: `pr${n}`,
      prNo: `PR-${n}`,
      status: body.status === "Submitted" ? "Submitted" : "Draft",
      requestedBy: body.requestedBy?.trim() || "Store L3",
      note: body.note?.trim() || undefined,
      items: items.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        supplier: it.supplier || "—",
        unit: it.unit || "pcs",
        qty: Math.max(0, Number(it.qty) || 0),
        cost: Math.max(0, Number(it.cost) || 0),
        barcode: it.barcode || undefined,
      })),
      createdAt: new Date().toISOString(),
      poIds: [],
    };
    db.purchaseRequests.push(pr);
    logAudit(db, {
      actor: pr.requestedBy,
      action: pr.status === "Submitted" ? "Submitted" : "Created draft",
      entityType: "PR",
      entity: pr.prNo,
      detail: `${pr.items.length} item${pr.items.length === 1 ? "" : "s"}`,
    });
    return pr;
  });

  return NextResponse.json(created, { status: 201 });
}
