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
  const m = (typeof body.invoice === "string" ? body.invoice : "").match(
    /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!m) return NextResponse.json({ error: "A scanned invoice image is required" }, { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8_000_000) {
    return NextResponse.json({ error: "Invoice image is too large (max 8 MB)." }, { status: 400 });
  }

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn) return null;
    // Approved invoices are final; missing or rejected (or still-pending) ones
    // may be scanned again.
    if (grn.invoice?.status === "Approved") return { error: "This invoice is already approved" as const };
    grn.invoice = {
      image: `${s.storeId}-${grn.id}-${Date.now()}.jpg`,
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
    await fs.writeFile(path.join(DATA_DIR, "invoices", result.grn.invoice!.image), buf);
  } catch {
    /* best-effort */
  }
  return NextResponse.json(result.grn.invoice, { status: 201 });
}
