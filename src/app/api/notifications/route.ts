import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";

export const dynamic = "force-dynamic";

// Notifications for the bell in the top bar.
//   actions — things waiting on someone right now (approvals, low stock)
//   events  — recent store activity (from the audit trail), newest first
//   counts  — per-page work queues, for the badge on the sidebar nav item
export async function GET() {
  const db = await readDB();

  const actions: { id: string; title: string; detail: string; href: string; tone: "amber" | "rose" | "brand" }[] = [];

  // A store raises a request; Procurement approves it and turns it into an
  // order. Both steps happen on /purchase-orders ("Requests from Operations") —
  // the Purchase Requests page can only raise and submit, so sending anyone
  // there to approve is a dead end.
  const submittedPRs = db.purchaseRequests.filter((p) => p.status === "Submitted");
  if (submittedPRs.length > 0) {
    actions.push({
      id: "prs-awaiting",
      title: `${submittedPRs.length} purchase request${submittedPRs.length === 1 ? "" : "s"} waiting approval`,
      detail: `From the stores — ${submittedPRs
        .slice(0, 3)
        .map((p) => p.prNo)
        .join(", ")}`,
      href: "/purchase-orders",
      tone: "rose",
    });
  }

  // Approved, but nobody has raised the PO yet. Without this the request goes
  // quiet after approval: it's off the "waiting approval" list but no order
  // exists, and only opening the page would show it.
  const approvedPRs = db.purchaseRequests.filter((p) => p.status === "Approved");
  if (approvedPRs.length > 0) {
    actions.push({
      id: "prs-approved",
      title: `${approvedPRs.length} approved request${approvedPRs.length === 1 ? "" : "s"} ready to order`,
      detail: `Generate the PO — ${approvedPRs
        .slice(0, 3)
        .map((p) => p.prNo)
        .join(", ")}`,
      href: "/purchase-orders",
      tone: "amber",
    });
  }

  // Goods still to receive: orders sent out (Open/Partial) with lines not yet
  // fully received — deliveries the team is still waiting on.
  const receivingPending = db.purchaseOrders.filter(
    (po) => (po.status === "Open" || po.status === "Partial") && po.items.some((i) => i.qtyReceived < i.qtyOrdered),
  );
  if (receivingPending.length > 0) {
    actions.push({
      id: "receiving-pending",
      title: `${receivingPending.length} goods receiving${receivingPending.length === 1 ? "" : "s"} pending`,
      detail: `Orders awaiting delivery — ${receivingPending
        .slice(0, 3)
        .map((p) => p.poNo)
        .join(", ")}`,
      href: "/receiving",
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

  // Receipts whose goods came in but whose invoice was never scanned — the
  // receiving process is not complete until it is.
  const missingInvoices = db.goodsReceipts.filter((g) => !g.invoice);
  if (missingInvoices.length > 0) {
    actions.push({
      id: "invoices-missing",
      title: `${missingInvoices.length} receipt${missingInvoices.length === 1 ? "" : "s"} missing the supplier invoice`,
      detail: `Receiving isn't complete until it's scanned — ${missingInvoices
        .slice(0, 3)
        .map((g) => g.grnNo)
        .join(", ")}`,
      href: "/receiving",
      tone: "rose",
    });
  }

  const pendingInvoices = db.goodsReceipts.filter((g) => g.invoice?.status === "Pending").length;
  if (pendingInvoices > 0) {
    actions.push({
      id: "invoices-pending",
      title: `${pendingInvoices} invoice${pendingInvoices === 1 ? "" : "s"} awaiting Accounting review`,
      detail: "Approve or reject the scanned supplier invoices",
      href: "/invoices",
      tone: "amber",
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

  // Work waiting on a page, keyed by its href, for the sidebar badge.
  //
  // Deliberately the same rule as the page's own "Requests from Operations"
  // list (Submitted + Approved) — a badge that says 3 must land you on 3 things
  // to do, or it's just noise you learn to ignore. Anything added here has to
  // match a real, actionable list on the page it marks.
  const counts: Record<string, number> = {
    "/purchase-orders": submittedPRs.length + approvedPRs.length,
  };

  return NextResponse.json({ actions, events, counts });
}
