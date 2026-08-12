/**
 * Writing the procurement export out as it is produced.
 *
 * Separated from the route so it can be TESTED, and it has to be: the file is
 * assembled by hand rather than by JSON.stringify — the records are stringified
 * whole, their closing brace is sliced off, and the images are appended one at
 * a time. That is a fiddly thing to get right and a silent thing to get wrong,
 * because a malformed file only announces itself on the far side, hours later,
 * as "that could not be read".
 *
 * WHY BY HAND. The first version built the whole object in memory: every
 * invoice photograph read into a Buffer, base64-encoded (a third larger again),
 * then JSON.stringify'd — which copies the lot a second time as one string. On
 * a small instance that is hundreds of megabytes for a store with any history,
 * and the process is killed for it. It took the SHOP down, not just the export:
 * the till, the reports and the login all live in this process, so an owner
 * pressing a migration button during trading got a 502 on the register.
 *
 * One image is read, encoded, pushed and released before the next is opened.
 * Nothing but the records is ever held whole.
 */

export type PageReader = (name: string) => Promise<string | null>;

/**
 * @param records everything except the images — already a plain object
 * @param pageNames the invoice pages to attach, in order
 * @param readPage returns a data URL, or null when the file is gone
 */
export function streamProcurementExport(
  records: Record<string, unknown>,
  pageNames: string[],
  readPage: PageReader,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = pieces(records, pageNames, readPage);
  return new ReadableStream<Uint8Array>({
    /*
     * PULL, NOT START — and this is the whole point, not a style choice.
     *
     * The first attempt at streaming did the work in start(): it read every
     * page as fast as the disk allowed and called enqueue() on each.
     * enqueue() does not wait for anybody. On a fast disk and a slow
     * connection — a phone on mobile data, downloading tens of megabytes —
     * the entire file simply accumulated in the stream's own queue instead of
     * in an object, and the process was killed exactly as before. The shop
     * went down a second time for the same reason wearing a different hat.
     *
     * pull() is called once per chunk the consumer is ready for, so the next
     * page is not even opened until the previous one is on the wire. Memory
     * now follows the SLOWER of the two ends, which is the only version of
     * this that is safe on a box that is also running a till.
     */
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      // The owner closed the tab or lost signal. Stop reading the disk.
      await chunks.return?.(undefined);
    },
  });
}

/**
 * The file, in the order it is written, one piece at a time.
 *
 * A generator rather than a loop, so that "produce the next piece" is
 * something the stream can ask for rather than something this code decides to
 * do. Anything thrown here reaches pull(), which errors the stream — the
 * download then FAILS rather than finishing short, because a truncated file
 * that looks complete would import cleanly on the far side and be silently
 * missing records.
 */
async function* pieces(
  records: Record<string, unknown>,
  pageNames: string[],
  readPage: PageReader,
): AsyncGenerator<string, void, undefined> {
  const head = JSON.stringify(records);
  // Everything but the closing brace, so the images can be appended as
  // further keys of the same object.
  yield head.slice(0, -1);
  yield ',"invoiceImages":{';

  let missingPages = 0;
  let first = true;
  for (const name of pageNames) {
    const encoded = await readPage(name);
    if (encoded === null) {
      /*
       * A page whose file is gone. Counted and reported rather than exported
       * as a name with nothing behind it: the importer drops any page it has
       * no image for, and this count is how anybody finds out that a
       * historical invoice lost its paper on THIS side, not in the move.
       */
      missingPages++;
      continue;
    }
    yield `${first ? "" : ","}${JSON.stringify(name)}:${JSON.stringify(encoded)}`;
    first = false;
  }

  yield `},"missingPages":${missingPages}}`;
}
