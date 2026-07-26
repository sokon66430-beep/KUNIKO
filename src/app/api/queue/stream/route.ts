import { getSession } from "@/lib/session";
import { subscribe } from "@/lib/realtime";

export const dynamic = "force-dynamic";
// Streaming needs the Node runtime; the Edge one would also bypass the session
// helpers this route relies on.
export const runtime = "nodejs";

/**
 * Live queue feed for the Kitchen Display and the customer TV.
 *
 * GET /api/queue/stream  →  text/event-stream
 *
 * The screens open this once and are told whenever the store's queue changes;
 * they then refetch the list. Sending the CHANGE rather than the data keeps the
 * payload trivial and means a screen that reconnects after an outage always
 * ends up consistent — it refetches on open regardless.
 *
 * The stream is scoped to the caller's store from their signed session, so a
 * screen can never be pointed at another branch's orders by editing a URL.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  const storeId = session.storeId;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client vanished between the publish and this write; cleanup
          // runs via cancel().
        }
      };

      // `retry` tells EventSource how soon to come back after a drop — this is
      // the auto-reconnect behaviour, handed to the browser rather than coded.
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      send("ready", { storeId, at: new Date().toISOString() });

      unsubscribe = subscribe(storeId, (event, payload) => send(event, payload));

      // A comment every 25s. Proxies (Render's included) close an idle
      // connection, and a kitchen can easily go quiet for minutes at a time.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          /* closed */
        }
      }, 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx-style proxies buffer by default, which would hold events back
      // until the buffer filled — exactly the lag this feature exists to avoid.
      "X-Accel-Buffering": "no",
    },
  });
}
