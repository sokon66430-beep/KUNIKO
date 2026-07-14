import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DATA_DIR } from "@/lib/system";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Attach (or re-scan) the supplier invoice on an existing receipt — used when
// goods were received first and the invoice is scanned afterwards, or when
// Accounting rejected the previous scan. Completes the receiving process.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // One or more pages: `invoices: string[]` or a single `invoice: string`.
  const rawPages: string[] = Array.isArray(body.invoices)
    ? body.invoices.filter((x: any) => typeof x === "string")
    : typeof body.invoice === "string" && body.invoice
      ? [body.invoice]
      : [];
  const bufs: Buffer[] = [];
  for (const url of rawPages) {
    const mm = url.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!mm) continue;
    const b = Buffer.from(mm[2], "base64");
    if (b.length > 8_000_000) {
      return NextResponse.json({ error: "An invoice page is too large (max 8 MB each)." }, { status: 400 });
    }
    bufs.push(b);
  }
  if (!bufs.length) return NextResponse.json({ error: "A scanned invoice image is required" }, { status: 400 });
  const stamp = Date.now();

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return null;
    // Approved invoices are final; missing or rejected (or still-pending) ones
    // may be scanned again.
    if (grn.invoice?.status === "Approved") return { error: "This invoice is already approved" as const };
    const images = bufs.map((_, i) => `${s.storeId}-${grn.id}-${stamp}-p${i + 1}.jpg`);
    grn.invoice = {
      image: images[0],
      images,
      uploadedBy: s.name,
      status: "Pending",
    };
    logAudit(db, {
      actor: s.name,
      action: "Scanned invoice",
      entityType: "GRN",
      entity: grn.grnNo,
      detail: "Invoice attached — awaiting Accounting review",
    });
    return { grn };
  });

  if (!result) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  try {
    await fs.mkdir(path.join(DATA_DIR, "invoices"), { recursive: true });
    const names = result.grn.invoice!.images || [result.grn.invoice!.image];
    await Promise.all(names.map((name, i) => fs.writeFile(path.join(DATA_DIR, "invoices", name), bufs[i])));
  } catch {
    /* best-effort */
  }
  return NextResponse.json(result.grn.invoice, { status: 201 });
}
