import { NextResponse } from "next/server";
import { matchesBarcode } from "@/lib/barcodes";
import { readDB, mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { postLedger } from "@/lib/ledger";
import { measureType } from "@/lib/writeoff";
import type { WriteOff } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/write-offs?from=ISO&to=ISO&reason=&q=   (newest first)
export async function GET(req: Request) {
  const db = await readDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const reason = url.searchParams.get("reason");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  let list = [...db.writeOffs];
  if (from) list = list.filter((w) => w.createdAt >= from);
  if (to) list = list.filter((w) => w.createdAt <= to);
  if (reason && reason !== "All") list = list.filter((w) => w.reason === reason);
  if (q) list = list.filter((w) => (w.barcode || "").includes(q) || w.productName.toLowerCase().includes(q));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  return NextResponse.json(list);
}

// POST — record a write-off and reduce stock.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const session = await getSession();
  const who = session?.name || "Staff";

  const qty = Number(body.quantity);
  const reason = String(body.reason || "").trim();
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "Quantity must be greater than 0" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }

  const result = await mutateDB((db) => {
    const product = db.products.find(
      (p) => p.id === body.productId || (body.barcode && matchesBarcode(p, body.barcode)),
    );
    if (!product) return { error: "not_found" as const };

    // A write-off is always allowed regardless of what stock shows; the
    // ledger clamps at zero and records what actually came off.
    postLedger(db, product, { type: "WRITE_OFF", qty: -qty, by: who, clampAtZero: true, note: reason });

    // Unit can be chosen on the form (kg / g / L / ml / pcs); default to the
    // product's own unit.
    const unit = (typeof body.unit === "string" && body.unit.trim()) || product.unit;

    const n = db.meta.nextWriteOff++;
    const now = new Date().toISOString();
    const wo: WriteOff = {
      id: `wo${n}`,
      woNo: `WO-${n}`,
      productId: product.id,
      sku: product.sku,
      barcode: product.barcode,
      productName: product.name,
      category: product.category,
      quantity: qty,
      unit,
      unitType: measureType(unit),
      cost: product.cost,
      reason,
      notes: String(body.notes || "").trim() || undefined,
      createdBy: who,
      createdAt: now,
    };
    db.writeOffs.push(wo);
    logAudit(db, {
      actor: who,
      action: "Written off",
      entityType: "WriteOff",
      entity: wo.woNo,
      detail: `${product.name} · ${qty} ${product.unit} · ${reason}`,
    });
    return { wo, stock: product.stock };
  });

  if ("error" in result) {
    const notFound = result.error === "not_found";
    return NextResponse.json(
      { error: notFound ? "Product not found" : result.error },
      { status: notFound ? 404 : 400 },
    );
  }
  return NextResponse.json(result, { status: 201 });
}
