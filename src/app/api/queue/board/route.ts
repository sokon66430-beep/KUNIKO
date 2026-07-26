import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatQueueCode } from "@/lib/queue";
import { storeToday } from "@/lib/storetime";

export const dynamic = "force-dynamic";

/**
 * What the customer TV shows: who is being made, and who can collect.
 *
 * Deliberately the smallest possible payload — codes and timestamps, no money,
 * no customer names, no item detail. This is rendered on a screen the whole
 * shop can see, so anything not needed to call a number has no business
 * being in the response.
 *
 * Only TODAY's tickets, because numbers restart each business day and showing a
 * stale A012 from yesterday would send the wrong person to the counter.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = await readDB();
  const today = storeToday();
  const cfg = db.meta.business.queueSettings || {};

  // Today's only. A ticket issued before letters existed carries no `day`, so
  // fall back to the date it was created — treating a missing day as "today"
  // would put every historical number on the TV the moment this ships.
  const dayOf = (t: { day?: string; createdAt: string }) => t.day ?? storeToday(new Date(t.createdAt));
  const live = db.queue.filter((t) => dayOf(t) === today && t.status !== "cancelled");
  const pick = (status: string) =>
    live
      .filter((t) => t.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((t) => ({
        id: t.id,
        code: formatQueueCode(t),
        at: t.status === "ready" ? t.readyAt || t.createdAt : t.createdAt,
        // The lane label shown beside the number, matching the store's existing
        // board ("Counter"). Falls back to Counter when nothing is routed.
        where: t.jobs && t.jobs.length ? t.jobs.map((j) => j.stationName).join(" · ") : "Counter",
      }));

  // Adverts are the SAME ones the Sunmi second screen already shows, read from
  // the Customer Screen settings. Reused deliberately: a shop should upload a
  // promo once, not once per screen it owns.
  const cd = db.meta.business.customerDisplay || {};

  return NextResponse.json({
    storeName: db.meta.business.name,
    logo: db.meta.business.logo || null,
    ads: cd.ads || [],
    adSeconds: cd.adSeconds || 6,
    // "preparing" and anything still waiting both read as "being made" to a
    // customer — they don't know or care whether a cook has pressed START.
    preparing: [...pick("waiting"), ...pick("preparing")].sort((a, b) => a.at.localeCompare(b.at)),
    ready: pick("ready"),
    voice: cfg.voice === true,
    voiceLang: cfg.voiceLang || "en-US",
    at: new Date().toISOString(),
  });
}
