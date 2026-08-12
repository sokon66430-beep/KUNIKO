/**
 * THE EXPORT FILE MUST STILL BE VALID JSON.
 *
 * It is assembled by hand — the records stringified whole, their closing brace
 * sliced off, images appended one at a time — because building it in memory
 * killed the process and took the shop's till down with it. That trade is
 * right, but it moves the risk: a malformed file announces itself hours later,
 * on the far side, as "that could not be read", after somebody has waited for
 * a large download.
 *
 * So every shape it can take is parsed back here.
 *
 *   npx tsx scripts/test-procurement-export.ts
 */
import { streamProcurementExport } from "../src/lib/procurementExport";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ok   ${name}`);
  else {
    console.error(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
    failures++;
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

const RECORDS = {
  format: "stookii-procurement",
  version: 1,
  exportedAt: "2026-08-12T02:00:00.000Z",
  store: { id: "on-mart-pdk", name: "ON Mart PDK" },
  purchaseRequests: [],
  purchaseOrders: [{ id: "po1", poNo: "PO-20260721-01", supplier: 'ABC "Trading" Co' }],
  goodsReceipts: [{ id: "grn1", grnNo: "GRN-42", note: "damaged — 2 boxes\nsigned" }],
};

async function main() {
  /* ---- the ordinary case ------------------------------------------------ */
  {
    const pages = ["a.jpg", "b.png"];
    const text = await collect(
      streamProcurementExport(RECORDS, pages, async (n) => `data:image/jpeg;base64,${n}`),
    );
    const parsed = JSON.parse(text);
    console.log("\na file with pages:");
    check("it parses", typeof parsed, "object");
    check("the records survive intact", parsed.purchaseOrders[0].poNo, "PO-20260721-01");
    /* Quotes and newlines in real supplier names and notes are exactly what
       breaks hand-assembled JSON. */
    check("a quoted supplier name survives", parsed.purchaseOrders[0].supplier, 'ABC "Trading" Co');
    check("a note with a newline survives", parsed.goodsReceipts[0].note, "damaged — 2 boxes\nsigned");
    check("both images are there", Object.keys(parsed.invoiceImages), ["a.jpg", "b.png"]);
    check("with their content", parsed.invoiceImages["b.png"], "data:image/jpeg;base64,b.png");
    check("and nothing is reported missing", parsed.missingPages, 0);
  }

  /* ---- a store with no invoice photographs at all ------------------------ */
  {
    const text = await collect(streamProcurementExport(RECORDS, [], async () => null));
    const parsed = JSON.parse(text);
    console.log("\na file with no pages:");
    /* The empty-object case is where a hand-rolled comma normally goes wrong. */
    check("it still parses", parsed.store.name, "ON Mart PDK");
    check("images is an empty object, not a stray comma", parsed.invoiceImages, {});
    check("and nothing is missing", parsed.missingPages, 0);
  }

  /* ---- pages whose file has gone ---------------------------------------- */
  {
    const text = await collect(
      streamProcurementExport(RECORDS, ["gone.jpg", "here.jpg", "gone2.jpg"], async (n) =>
        n === "here.jpg" ? "data:image/jpeg;base64,X" : null,
      ),
    );
    const parsed = JSON.parse(text);
    console.log("\na file with pages whose image is gone:");
    /* The leading-comma bug lives here: the FIRST page failed, so the second
       must not be written with a comma in front of it. */
    check("the surviving page is the only key", Object.keys(parsed.invoiceImages), ["here.jpg"]);
    check("and the gaps are counted, not exported as empty names", parsed.missingPages, 2);
  }

  /* ---- every page gone --------------------------------------------------- */
  {
    const text = await collect(streamProcurementExport(RECORDS, ["x.jpg", "y.jpg"], async () => null));
    const parsed = JSON.parse(text);
    console.log("\na file where every page is gone:");
    check("it parses", parsed.invoiceImages, {});
    check("and says so", parsed.missingPages, 2);
  }

  /* ---- a reader that throws ---------------------------------------------- */
  {
    console.log("\na disk that fails half way:");
    const stream = streamProcurementExport(RECORDS, ["a.jpg", "b.jpg"], async (n) => {
      if (n === "b.jpg") throw new Error("disk gone");
      return "data:image/jpeg;base64,A";
    });
    let errored = false;
    try {
      await collect(stream);
    } catch {
      errored = true;
    }
    /*
     * The download must FAIL, not finish short. A truncated file that looks
     * complete is the one outcome worse than no file: it would import cleanly
     * on the far side and be silently missing records.
     */
    check("the download fails rather than finishing truncated", errored, true);
  }

  console.log(
    failures === 0 ? "\nAll procurement export assertions passed.\n" : `\n${failures} FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
