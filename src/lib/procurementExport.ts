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
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        const head = JSON.stringify(records);
        // Everything but the closing brace, so the images can be appended as
        // further keys of the same object.
        push(head.slice(0, -1));
        push(',"invoiceImages":{');

        let missingPages = 0;
        let first = true;
        for (const name of pageNames) {
          const encoded = await readPage(name);
          if (encoded === null) {
            /*
             * A page whose file is gone. Counted and reported rather than
             * exported as a name with nothing behind it: the importer drops any
             * page it has no image for, and this count is how anybody finds out
             * that a historical invoice lost its paper on THIS side, not in the
             * move.
             */
            missingPages++;
            continue;
          }
          push(`${first ? "" : ","}${JSON.stringify(name)}:${JSON.stringify(encoded)}`);
          first = false;
        }

        push(`},"missingPages":${missingPages}}`);
        controller.close();
      } catch (err) {
        /*
         * ABORTED, never closed. A truncated file that LOOKS complete is the
         * one outcome worse than a failed download: it would import cleanly on
         * the far side and be silently missing records.
         */
        controller.error(err);
      }
    },
  });
}
