import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canMarkDown, isReadOnly } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { currentActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// Pull a label early. The record is CANCELLED, never deleted: sales already rung
// up under this code still need it to resolve, and the audit trail should show
// the discount ran. Cancelling stops it scanning from that moment.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isReadOnly(session.role) || !canMarkDown(session.role)) {
    return NextResponse.json({ error: "Your role can't discount products." }, { status: 403 });
  }

  const actor = await currentActor();
  const result = await mutateDB((db) => {
    const m = db.markdowns.find((x) => x.id === params.id);
    if (!m) return { error: "Markdown not found" };
    if (m.cancelledAt) return { error: "That label is already stopped." };
    m.cancelledAt = new Date().toISOString();
    m.cancelledBy = actor;
    logAudit(db, {
      actor,
      action: "Stopped",
      entityType: "Markdown",
      entity: `${m.code} · ${m.name}`,
      detail: `${m.percent}% label pulled early (was running to ${m.endDate})`,
    });
    return { markdown: m };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.markdown);
}
