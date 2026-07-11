import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// Notifications for the bell in the top bar.
//   actions — things waiting on someone right now (approvals, low stock)
//   events  — recent store activity (from the audit trail), newest first
export async function GET() {
  const db = await readDB();

  const actions: { id: string; title: string; detail: string; href: string; tone: "amber" | "rose" | "brand" }[] = [];

  const submittedPRs = db.purchaseRequests.filter((p) => p.status === "Submitted");
  if (submittedPRs.length > 0) {
    actions.push({
      id: "prs-awaiting",
      title: `${submittedPRs.length} purchase request${submittedPRs.length === 1 ? "" : "s"} awaiting approval`,
      detail: submittedPRs
        .slice(0, 3)
        .map((p) => p.prNo)
        .join(", "),
      href: "/purchase-orders",
      tone: "amber",
    });
  }

  const pendingGrns = db.goodsReceipts.filter((g) => g.status === "PendingApproval");
  if (pendingGrns.length > 0) {
    actions.push({
      id: "grn-pending",
      title: `${pendingGrns.length} receipt edit${pendingGrns.length === 1 ? "" : "s"} need manager approval`,
      detail: pendingGrns
        .slice(0, 3)
        .map((g) => g.grnNo)
        .join(", "),
      href: "/receiving",
      tone: "rose",
    });
  }

  const low = db.products.filter((p) => p.reorderLevel > 0 && p.stock <= p.reorderLevel).length;
  if (low > 0) {
    actions.push({
      id: "low-stock",
      title: `${low} item${low === 1 ? "" : "s"} at or below minimum stock`,
      detail: "Review reorder suggestions",
      href: "/purchase-requests",
      tone: "brand",
    });
  }

  const events = [...(db.auditLog || [])]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 25)
    .map((e) => ({
      id: e.id,
      at: e.at,
      actor: e.actor,
      action: e.action,
      entityType: e.entityType,
      entity: e.entity,
      detail: e.detail || "",
    }));

  return NextResponse.json({ actions, events });
}
