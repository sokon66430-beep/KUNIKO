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

  // Idempotent, and called from BOTH the cancel hook and any failed write.
  // Relying on cancel() alone leaks: a TV that is switched off at the wall never
  // closes the connection politely, so the first thing to notice is a write
  // throwing — and if that throw is swallowed, the heartbeat interval and the
  // subscriber both live on for the life of the process. A shop power-cycling
  // its screens daily would accumulate dead subscribers until a redeploy.
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      // Returns false once the connection is gone, so callers stop writing.
      const write = (chunk: string): boolean => {
        if (cleanedUp) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      // `retry` tells EventSource how soon to come back after a drop — this is
      // the auto-reconnect behaviour, handed to the browser rather than coded.
      write("retry: 3000\n\n");
      send("ready", { storeId, at: new Date().toISOString() });

      unsubscribe = subscribe(storeId, (event, payload) => send(event, payload));

      // A comment every 25s. Proxies (Render's included) close an idle
      // connection, and a kitchen can easily go quiet for minutes at a time.
      // This is also what DETECTS a screen that vanished without disconnecting.
      heartbeat = setInterval(() => write(": keep-alive\n\n"), 25_000);
    },
    cancel: cleanup,
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
