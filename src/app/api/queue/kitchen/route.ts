import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatQueueCode } from "@/lib/queue";
import { storeToday } from "@/lib/storetime";
import type { Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * What the Kitchen Display shows: today's live orders and what has to be made.
 *
 * Unlike /api/queue/board (a public-facing TV, numbers only) this DOES carry the
 * item lines — that is the whole point of the screen. It stays behind the login
 * for that reason.
 *
 * Today's orders only. A ticket from yesterday is not something anyone is still
 * cooking, and leaving it on the line is how a screen becomes noise that staff
 * stop reading.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = await readDB();
  const today = storeToday();
  const stationId = new URL(req.url).searchParams.get("station") || "";

  const saleById = new Map<string, Sale>(db.sales.map((s) => [s.id, s]));
  const dayOf = (t: { day?: string; createdAt: string }) => t.day ?? storeToday(new Date(t.createdAt));

  const tickets = db.queue
    .filter((t) => dayOf(t) === today && t.status !== "cancelled")
    // A completed order is off the line, but keep it reachable for the last
    // stretch of the day so "I pressed COMPLETED by mistake" is recoverable
    // rather than a lost order — the screen puts them in their own tab.
    .filter((t) => {
      if (!stationId) return true;
      // Filtering by station hides orders that station has nothing to do with.
      // An order with NO stations routed (plain retail, or products not yet
      // linked to a station) stays visible everywhere: better that two people
      // see it than that it falls through the gap between two screens.
      return !t.jobs || t.jobs.length === 0 || t.jobs.some((j) => j.stationId === stationId);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) // oldest first — cook in order
    .map((t) => {
      const sale = saleById.get(t.saleId);
      const lane = stationId ? (t.jobs || []).find((j) => j.stationId === stationId) : undefined;
      return {
        id: t.id,
        code: formatQueueCode(t),
        status: t.status,
        receiptNo: t.receiptNo,
        cashier: t.cashier,
        terminal: t.posTerminalId ?? null,
        createdAt: t.createdAt,
        startedAt: t.startedAt ?? null,
        readyAt: t.readyAt ?? null,
        // The lines to make. When this screen is filtered to one station, show
        // only that station's items — a grill cook reading the drinks off the
        // same ticket is how the wrong thing gets made.
        items: lane
          ? lane.items
          : t.jobs && t.jobs.length
            ? t.jobs.flatMap((j) => j.items)
            : (sale?.items || []).map((it) => ({ name: it.name, qty: it.qty })),
        // Each station's own progress, so a screen watching everything can see
        // the Grill is done while the Fry is still going.
        jobs: (t.jobs || []).map((j) => ({
          stationId: j.stationId,
          stationName: j.stationName,
          status: j.status,
          items: j.items,
        })),
        // The status THIS screen acts on: the station's lane when filtered,
        // otherwise the whole ticket.
        laneStatus: lane ? lane.status : t.status,
      };
    });

  return NextResponse.json({
    today,
    // Only active stations — a station switched off shouldn't offer itself as a
    // screen to stand in front of.
    stations: (db.kitchenStations || [])
      .filter((s) => s.active)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, name: s.name })),
    station: stationId || null,
    tickets,
    at: new Date().toISOString(),
  });
}
