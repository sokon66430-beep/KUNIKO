import { createHash } from "crypto";
import { NextResponse } from "next/server";

/**
 * JSON response with an ETag, answering 304 Not Modified when the caller
 * already has this exact payload.
 *
 * Why: every screen polls its endpoints on a timer so a price changed in the
 * back office reaches the tills without anyone pressing refresh. That is right
 * for a shift status; it was ruinous for the catalogue, which is over a
 * megabyte and barely changes — each till was pulling all of it down every 20
 * seconds, all day, to catch an edit that happens twice.
 *
 * The fix is the one every till system uses: send a fingerprint of the payload,
 * and when the caller sends it back unchanged, reply with a bare 304 and no
 * body. A poll costs a few hundred bytes instead of 1.2 MB, and the device
 * skips the JSON parse and the re-render entirely — which on a Sunmi T3 is the
 * part that actually shows as lag.
 *
 * Cost on the server is one hash of the payload. Cheap next to the disk read
 * that produced it, and it replaces sending the whole thing over shop wifi.
 *
 * Degrades safely: if anything between here and the till strips the header, the
 * fingerprint never matches, every poll answers 200, and behaviour is exactly
 * what it was before.
 */
export function jsonWithEtag(req: Request, payload: unknown): NextResponse {
  const body = JSON.stringify(payload ?? null);
  const etag = `"${createHash("sha1").update(body).digest("base64")}"`;

  if (req.headers.get("if-none-match") === etag) {
    // 304 MUST carry no body — the caller keeps what it already had.
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ETag: etag,
      // The freshness rule is ours, not a cache's: always revalidate, and the
      // ETag decides. Without this a proxy could serve a stale price list.
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}
