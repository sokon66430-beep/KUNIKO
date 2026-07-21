import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { masterDataFor } from "@/lib/caps";
import { readMaster, mutateMaster } from "@/lib/master";
import { resolveSupplier } from "@/lib/supplierLink";
import { readDB } from "@/lib/db";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireMasterAccess() {
  const session = await getSession();
  return session && (await masterDataFor(session.role)) ? session : null;
}

export async function GET() {
  if (!(await requireMasterAccess())) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const products = await readMaster();
  return NextResponse.json(products);
}

// Add a product to the master catalog. It reaches the stores when the owner
// clicks "Sync to stores".
export async function POST(req: Request) {
  const session = await requireMasterAccess();
  if (!session) return NextResponse.json({ error: "Master Data access required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body?.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // Suppliers still live per-store; resolve against the owner's current store so
  // the master carries a real supplier name/code.
  const db = await readDB(session.storeId);
  const sup = resolveSupplier(db.suppliers, body.supplier, body.supplierCode);

  const created = await mutateMaster((products) => {
    const nextNum = products.reduce((max, p) => Math.max(max, parseInt(p.id.slice(1)) || 0), 0) + 1;
    const id = `p${String(nextNum).padStart(4, "0")}`;
    const product: Product = {
      id,
      sku: String(body.sku || "").trim() || `SKU-${id.slice(1)}`,
      name: String(body.name).trim(),
      nameKh: body.nameKh?.trim() || undefined,
      ranking: ["A", "B", "C", "D"].includes(body.ranking) ? body.ranking : "A",
      shelfLifeDays: body.shelfLifeDays ? Number(body.shelfLifeDays) || undefined : undefined,
      groupCode: body.groupCode?.trim() || undefined,
      category: String(body.category || "Uncategorized").trim() || "Uncategorized",
      supplier: sup.status === "ok" ? sup.name : "—",
      supplierCode: sup.status === "ok" ? sup.code : undefined,
      unit: String(body.unit || "U").trim() || "U",
      cost: Math.max(0, Number(body.cost) || 0),
      price: Math.max(0, Number(body.price) || 0),
      stock: 0,
      reorderLevel: Math.max(0, Number(body.reorderLevel) || 0),
      barcode: body.barcode?.trim() || undefined,
      gondola: body.gondola?.trim() || undefined,
      shelf: body.shelf?.trim() || undefined,
      trackStock: body.trackStock ?? true,
    };
    products.push(product);
    return product;
  });

  return NextResponse.json(created, { status: 201 });
}
