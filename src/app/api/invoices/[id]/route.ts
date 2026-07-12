import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Accounting decision on a receipt's invoice: Approve, or Reject with an
// optional note explaining why. Only Accounting reviews invoices (owner oversees).
const REVIEW_ROLES = new Set(["accountant", "owner"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!REVIEW_ROLES.has(s.role)) {
    return NextResponse.json({ error: "Only Accounting can review invoices" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body.status === "Approved" ? "Approved" : body.status === "Rejected" ? "Rejected" : null;
  if (!status) return NextResponse.json({ error: "status must be Approved or Rejected" }, { status: 400 });

  const result = await mutateDB((db) => {
    const grn = db.goodsReceipts.find((g) => g.id === params.id);
    if (!grn || !grn.invoice) return null;
    grn.invoice.status = status;
    grn.invoice.reviewedBy = s.name;
    grn.invoice.reviewedAt = new Date().toISOString();
    grn.invoice.reviewNote = body.note?.trim() || undefined;
    logAudit(db, {
      actor: s.name,
      action: status === "Approved" ? "Approved" : "Rejected",
      entityType: "GRN",
      entity: `Invoice ${grn.grnNo}`,
      detail: body.note?.trim() || undefined,
    });
    return grn.invoice;
  });

  if (!result) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(result);
}
