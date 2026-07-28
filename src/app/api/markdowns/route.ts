import { NextResponse } from "next/server";
import { jsonWithEtag } from "@/lib/httpCache";
import { readDB, mutateDB } from "@/lib/db";
import type { Markdown } from "@/lib/types";
import { getSession } from "@/lib/session";
import { canMarkDown, isReadOnly } from "@/lib/access";
import { markdownCode, markdownPrice, storeToday, MARKDOWN_PERCENTS } from "@/lib/markdowns";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const db = await readDB();
  // Newest first — the label you just made is the one you're about to print.
  const list = [...db.markdowns].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return jsonWithEtag(req, list);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isReadOnly(session.role) || !canMarkDown(session.role)) {
    return NextResponse.json({ error: "Your role can't discount products." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const percent = Number(body.percent);
  const startDate: string = body.startDate;
  const endDate: string = body.endDate;

  if (!MARKDOWN_PERCENTS.includes(percent)) {
    return NextResponse.json({ error: "Discount must be 30, 50 or 70%." }, { status: 400 });
  }
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) {
    return NextResponse.json({ error: "Start and end dates are required." }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });
  }
  const today = storeToday();
  if (endDate < today) {
    return NextResponse.json({ error: "That end date has already passed." }, { status: 400 });
  }

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const product = db.products.find((p) => p.id === body.productId);
    if (!product) return { error: "Product not found" };

    // One live label per product: a second overlapping one would put two
    // different discount barcodes on the same shelf with no way to tell which
    // the customer should get.
    const clash = db.markdowns.find(
      (m) => m.productId === product.id && !m.cancelledAt && m.endDate >= today && m.startDate <= endDate && m.endDate >= startDate,
    );
    if (clash) {
      return { error: `${product.name} already has a ${clash.percent}% label running to ${clash.endDate}.` };
    }

    const seq = db.meta.nextMarkdown;
    const m: Markdown = {
      id: `md${seq}`,
      code: markdownCode(seq),
      productId: product.id,
      sku: product.sku,
      name: product.name,
      nameKh: product.nameKh,
      category: product.category,
      productBarcode: product.barcode,
      originalPrice: product.price,
      percent,
      price: markdownPrice(product.price, percent),
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      createdBy: actor,
    };
    db.meta.nextMarkdown += 1;
    db.markdowns.push(m);
    logAudit(db, {
      actor,
      action: "Created",
      entityType: "Markdown",
      entity: `${m.code} · ${product.name}`,
      detail: `${percent}% off — $${m.originalPrice.toFixed(2)} → $${m.price.toFixed(2)}, ${startDate} to ${endDate}`,
    });
    return { markdown: m };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.markdown, { status: 201 });
}
