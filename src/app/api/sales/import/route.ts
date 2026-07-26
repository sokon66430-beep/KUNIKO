import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageStaff } from "@/lib/access";
import { currentActor } from "@/lib/actor";
import ExcelJS from "exceljs";
import { readDB, mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { storeInstant, storeToday } from "@/lib/storetime";
import { postLedger } from "@/lib/ledger";
import type { Sale, SaleItem, StockCountItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Import sales from the shop's POS report so reports, order recommendations and
// STOCK reflect what actually sold. Expected columns (any order,
// case-insensitive):
//   Date · Item Code (or Barcode) · Qty · Price (optional) · Time (optional)
// Rows are grouped by date into one sale per day for reporting.
//
// Stock: selling happens in another POS, so this file is the only thing that
// tells the app a shelf emptied. Every matched line reduces stock. The one
// exception is a product with a posted count/opening baseline: there, only
// lines that sold AFTER that baseline come off (earlier ones are already inside
// the counted number) — see the long note at the deduction itself. Products with
// no baseline at all deduct in full. Same-day rows with no time to place them
// against an OPEN count are the only ones left alone, and are reported back.
//
// Validation is all-or-nothing: if any ITEM row can't be fully read (no
// matching product, missing qty, or — when a Date column is present — an
// unreadable date), nothing is imported. Summary rows ("Total …",
// "Grand Total") and rows with no product reference at all aren't items and
// are skipped without complaint. If any date in the file already has sales
// on record, nothing is imported either, so a day's figures can never be
// double-counted by importing the same report twice.
const ALIASES: Record<string, string[]> = {
  date: ["date", "sale date", "sold date", "invoice date"],
  // Time of day, used to decide whether a sale happened before or after the
  // shelf was counted (see the stock note further down). Optional — a report
  // without it still imports, it just can't settle a same-day sale against a
  // same-day count.
  time: ["time", "sale time", "sold time", "invoice time", "transaction time", "hour"],
  sku: ["item code", "item id", "sku", "product code", "system product code"],
  barcode: ["barcode", "barcodes", "default barcodes", "default barcode"],
  name: ["item name", "product name", "name"],
  qty: ["qty", "quantity", "units", "qty sold", "units sold"],
  price: ["price", "unit price", "sell price", "selling price"],
  invoice: ["invoice no", "invoice", "invoice number", "invoice #", "receipt no", "receipt", "bill no"],
  // Line discount amount (money off this line), e.g. the report's "Discount"
  // column. NOT "After Dis." (the post-discount total) — that normalizes to
  // "afterdis" and won't match these aliases.
  discount: ["discount", "disc", "discount amount", "discount amt"],
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};

// Normalizers so a product still matches despite cosmetic differences between
// the sheet and the master. Header names ignore spacing/punctuation ("Item ID"
// == "item-id"); barcodes ignore stray spaces; item codes and names ignore case
// and extra whitespace. All are exact-after-normalizing (never fuzzy), so they
// can't cause a wrong product to match.
const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const cleanBarcode = (s: string) => s.replace(/\s+/g, "");
const cleanSku = (s: string) => s.trim().toLowerCase();
const cleanName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Build a yyyy-mm-dd only if (y, mo, d) is a REAL calendar day. This rejects
// impossible dates like 31 June or 30 Feb instead of letting `new Date` silently
// roll them into the next month (e.g. 31 June → 1 July), which would file a sale
// on the wrong day.
function ymd(y: number, mo: number, d: number): string | null {
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}`;
}

// Best-effort date parse → yyyy-mm-dd. Accepts Excel Date cells (including a
// formula cell whose computed result is a Date) and common text.
function toDayKey(cellValue: any, text: string): string | null {
  if (cellValue && typeof cellValue === "object" && (cellValue as any).result instanceof Date) {
    cellValue = (cellValue as any).result;
  }
  if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
    // ExcelJS stores a spreadsheet date as a UTC instant, so read the calendar
    // day in UTC. Using the server-LOCAL getDate() would slip a late-night time
    // (e.g. a sale at 11:21 PM on 30 June) into the next day on a server whose
    // timezone is ahead of UTC — which is exactly what put June sales on 1 July.
    return ymd(cellValue.getUTCFullYear(), cellValue.getUTCMonth() + 1, cellValue.getUTCDate());
  }
  const t = (text || "").trim();
  if (!t) return null;
  // yyyy-mm-dd or yyyy/mm/dd
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  // dd/mm/yyyy or dd-mm-yyyy (day first — the shop's local convention)
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * "HH:MM" for a row, or null if the sheet doesn't say.
 *
 * Looks in the Time column first, then falls back to a time carried inside the
 * Date cell (Excel datetimes are one cell). Both are read in UTC because that's
 * how ExcelJS represents a spreadsheet's naive wall-clock — the same reason
 * toDayKey reads getUTC*.
 *
 * Exactly midnight in a Date cell is treated as "no time given": a date-only
 * cell is indistinguishable from one stamped 00:00, and guessing wrong on a
 * date-only report would silently mark every sale as pre-dawn.
 */
function toHHMM(timeCellValue: any, timeText: string, dateCellValue: any): string | null {
  const p = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (timeCellValue && typeof timeCellValue === "object" && (timeCellValue as any).result instanceof Date) {
    timeCellValue = (timeCellValue as any).result;
  }
  if (timeCellValue instanceof Date && !isNaN(timeCellValue.getTime())) {
    return p(timeCellValue.getUTCHours(), timeCellValue.getUTCMinutes());
  }
  const t = (timeText || "").trim();
  if (t) {
    // "9:05", "09:05:22", "9:05 PM"
    const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (m) {
      let h = +m[1];
      const min = +m[2];
      const ap = (m[3] || "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return p(h, min);
    }
  }
  if (dateCellValue && typeof dateCellValue === "object" && (dateCellValue as any).result instanceof Date) {
    dateCellValue = (dateCellValue as any).result;
  }
  if (dateCellValue instanceof Date && !isNaN(dateCellValue.getTime())) {
    const h = dateCellValue.getUTCHours();
    const mi = dateCellValue.getUTCMinutes();
    if (h !== 0 || mi !== 0) return p(h, mi);
  }
  return null;
}

export async function POST(req: Request) {
  // Leadership only. This endpoint rewrites sales history AND drives stock down
  // through the ledger, so an ordinary till login must not reach it: a cashier
  // could otherwise upload a spreadsheet that "sells" the stock they took, and
  // during an open stock count those quantities land in soldAfterCount — which
  // is exactly how a shelf shortage gets papered over mid-audit.
  const session = await getSession();
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  }
  const actor = await currentActor();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  } catch {
    return NextResponse.json({ error: "Could not read the file — is it a valid .xlsx?" }, { status: 400 });
  }
  const ws = wb.getWorksheet("Sales") ?? wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "The workbook has no sheets" }, { status: 400 });

  const cellText = (r: number, c: number) => {
    const cell = ws.getRow(r).getCell(c);
    // ExcelJS's `.text` isn't always a plain string (rich text / formula-error
    // cells can return an object) — fall back to the raw value so a stray
    // cell never renders as the literal text "[object Object]".
    let raw: any = cell.text;
    if (raw && typeof raw === "object") raw = cell.value;
    if (raw && typeof raw === "object" && !(raw instanceof Date)) {
      raw = (raw as any).result ?? (raw as any).text ?? (raw as any).richText?.map((p: any) => p.text).join("") ?? "";
    }
    if (raw instanceof Date) raw = isNaN(raw.getTime()) ? "" : raw.toISOString().slice(0, 10);
    // Still an object (e.g. a formula-error result)? There's no readable text.
    if (raw && typeof raw === "object") raw = "";
    const t = String(raw ?? "").trim();
    if (/^\d(\.\d+)?e\+\d+$/i.test(t)) {
      const v: any = cell.value;
      const n = typeof v === "number" ? v : v && typeof v === "object" && typeof v.result === "number" ? v.result : NaN;
      if (isFinite(n)) return n.toFixed(0);
    }
    return t;
  };

  const maxCol = Math.min(ws.columnCount || 40, 60);
  let headerRow = 0;
  const colOf: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const texts: string[] = [];
    for (let c = 1; c <= maxCol; c++) texts[c] = normHeader(cellText(r, c));
    const find = (key: string) => {
      for (const alias of ALIASES[key]) {
        const a = normHeader(alias);
        for (let c = 1; c <= maxCol; c++) if (texts[c] === a) return c;
      }
      return 0;
    };
    // Need a product identifier + a quantity to count a sale.
    if ((find("sku") || find("barcode") || find("name")) && find("qty")) {
      headerRow = r;
      for (const key of Object.keys(ALIASES)) {
        const c = find(key);
        if (c) colOf[key] = c;
      }
    }
  }
  if (!headerRow) {
    return NextResponse.json(
      { error: 'No header row found — the sheet needs an "Item Code" (or "Barcode") column plus a "Qty" column.' },
      { status: 400 },
    );
  }

  // A daily sales report MUST carry the date so every sale is recorded on the
  // day it happened. Without a Date column the import would silently pile the
  // whole file onto today's date and quietly corrupt the report — so we refuse.
  if (!colOf.date) {
    return NextResponse.json(
      {
        error:
          'No "Date" column found — a sales report must include a Date column so each sale is recorded on the day it happened.',
      },
      { status: 400 },
    );
  }

  // Summary/footer rows ("Total ON MART TOUL KORK 592", "Grand Total",
  // "Subtotal …") aren't items — they're skipped without complaint. A row
  // counts as a summary row when any cell starts with a total-style label.
  const TOTAL_LABEL = /^\s*(grand\s+|sub\s*)?totals?\b/i;
  const isSummaryRow = (r: number) => {
    for (let c = 1; c <= maxCol; c++) {
      if (TOTAL_LABEL.test(cellText(r, c))) return true;
    }
    return false;
  };

  // Pass 1: read every ITEM row strictly. Rows with no product reference at
  // all (spacer rows, section footers holding only summed numbers) aren't
  // items, so they're skipped like blank rows — but a real item row missing
  // its qty/date is still a hard problem, never silently dropped.
  type Row = { day: string; time: string | null; invoice: string; sku: string; barcode: string; name: string; qty: number; price: number; discount: number; rowNum: number };
  // Structured so the UI can lay it out as a table (Row · Product · Issue · Qty).
  type Problem = { row: number; product: string; issue: string; qty: number };
  const rows: Row[] = [];
  const problems: Problem[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const dateText = colOf.date ? cellText(r, colOf.date) : "";
    const dateCellValue = colOf.date ? ws.getRow(r).getCell(colOf.date).value : null;
    const qtyText = colOf.qty ? cellText(r, colOf.qty) : "";
    const sku = colOf.sku ? cellText(r, colOf.sku) : "";
    const barcode = colOf.barcode ? cellText(r, colOf.barcode) : "";
    const name = colOf.name ? cellText(r, colOf.name) : "";
    if (!dateText && !qtyText && !sku && !barcode && !name) continue; // fully blank row

    const qty = num(qtyText);
    const hasProductRef = !!(sku || barcode || name);
    if (!hasProductRef || isSummaryRow(r)) continue; // not an item row
    if (qty <= 0) {
      problems.push({ row: r, product: sku || barcode || name, issue: "Missing or invalid quantity", qty });
      continue;
    }
    const day = toDayKey(dateCellValue, dateText);
    if (!day) {
      problems.push({ row: r, product: sku || barcode || name, issue: `Unreadable date "${dateText || "(blank)"}"`, qty });
      continue;
    }
    rows.push({
      day,
      time: toHHMM(
        colOf.time ? ws.getRow(r).getCell(colOf.time).value : null,
        colOf.time ? cellText(r, colOf.time) : "",
        dateCellValue,
      ),
      invoice: colOf.invoice ? cellText(r, colOf.invoice) : "",
      sku,
      barcode,
      name,
      qty,
      price: colOf.price ? num(cellText(r, colOf.price)) : 0,
      discount: colOf.discount ? num(cellText(r, colOf.discount)) : 0,
      rowNum: r,
    });
  }
  if (rows.length === 0 && problems.length === 0) {
    return NextResponse.json({ error: "No sale rows found under the header" }, { status: 400 });
  }

  // Pass 2: every row must match a real product — no partial imports.
  const db = await readDB();
  const byBarcode = new Map<string, any>();
  const bySku = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const p of db.products) {
    if (p.barcode) byBarcode.set(cleanBarcode(p.barcode), p);
    if (p.sku) bySku.set(cleanSku(p.sku), p);
    byName.set(cleanName(p.name), p);
  }

  type Matched = { productId: string; sku: string; name: string; qty: number; price: number; cost: number; day: string; time: string | null; invoice: string; discount: number };
  const matched: Matched[] = [];
  const skippedMap = new Map<string, { code: string; barcode: string; name: string; rows: number; units: number }>();
  for (const row of rows) {
    const p =
      (row.barcode && byBarcode.get(cleanBarcode(row.barcode))) ||
      (row.sku && bySku.get(cleanSku(row.sku))) ||
      (row.name && byName.get(cleanName(row.name)));
    if (!p) {
      problems.push({ row: row.rowNum, product: row.name || row.sku || row.barcode, issue: "No product found", qty: row.qty });
      const key = (row.barcode || row.sku || row.name).toLowerCase();
      const ex = skippedMap.get(key);
      if (ex) {
        ex.rows += 1;
        ex.units += row.qty;
      } else {
        skippedMap.set(key, { code: row.sku, barcode: row.barcode, name: row.name, rows: 1, units: row.qty });
      }
      continue;
    }
    matched.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      qty: row.qty,
      price: row.price || p.price,
      cost: p.cost,
      day: row.day,
      time: row.time,
      invoice: row.invoice,
      discount: row.discount,
    });
  }

  if (problems.length > 0) {
    problems.sort((a, b) => a.row - b.row);
    const skippedItems = [...skippedMap.values()].sort((a, b) => b.rows - a.rows);
    return NextResponse.json(
      {
        error: `${problems.length} row${problems.length === 1 ? "" : "s"} could not be read in full — nothing was imported. Fix these and re-upload.`,
        // Return them all (up to a safety cap) so the list can show everything.
        problems: problems.slice(0, 2000),
        totalProblems: problems.length,
        skippedItems,
      },
      { status: 400 },
    );
  }

  // De-duplicate at the TRANSACTION level, not the whole day. Each imported
  // day-sale remembers the source invoice numbers it was built from, so a row
  // whose (day + invoice) is already on record is skipped while the rest of that
  // day still imports. This is what lets a June report's after-midnight sales
  // (which already landed on 1 July) coexist with the July report's daytime
  // 1 July sales — only the shared midnight invoices are skipped, never the whole
  // day. The (day + invoice) pairing is safe even if a POS resets invoice numbers
  // each day. When the file has no Invoice column we can't tell transactions
  // apart, so we fall back to skipping any day already on record (never
  // double-counts).
  const hasInvoiceCol = !!colOf.invoice;
  const existingInvoiceKeys = new Set(
    db.sales.flatMap((s) => (s.sourceInvoices ?? []).map((inv) => `${s.createdAt.slice(0, 10)}|${inv}`)),
  );
  const existingDays = new Set(db.sales.map((s) => s.createdAt.slice(0, 10)));

  let toImport: Matched[];
  let skippedDuplicates = 0; // transactions (or day-rows) already on record
  const skippedDates: string[] = [];
  if (hasInvoiceCol) {
    toImport = matched.filter((m) => {
      if (m.invoice && existingInvoiceKeys.has(`${m.day}|${m.invoice}`)) {
        skippedDuplicates++;
        return false;
      }
      return true;
    });
  } else {
    skippedDates.push(...[...new Set(matched.map((m) => m.day))].filter((d) => existingDays.has(d)).sort());
    const skipDays = new Set(skippedDates);
    toImport = matched.filter((m) => !skipDays.has(m.day));
    skippedDuplicates = matched.length - toImport.length;
  }

  if (toImport.length === 0) {
    // Everything in the file is already on record — nothing new to add.
    return NextResponse.json({ matched: 0, salesCreated: 0, totalRows: rows.length, skippedDuplicates, skippedDates });
  }

  const result = await mutateDB((db) => {
    // -----------------------------------------------------------------------
    // A product sitting in an OPEN count is reconciled into that count instead
    // of having its stock touched here.
    //
    // The audit team counts a live shop floor: they wrote down 5 at 10:00 and a
    // customer bought 1 at 10:00, so the shelf holds 4 — but only this file
    // knows that, and only while it's being read. An imported sale is stored
    // grouped by day and stamped noon, so the moment this route returns, the
    // clock that decides "before or after the count?" is gone for good.
    //
    // So the answer is recorded now, on the line: soldAfterCount. Posting the
    // count then lands on 4 rather than 5, and the count sheet can show the
    // audit team the number they'd have got if the shop had stood still.
    //
    // Stock is deliberately NOT reduced for these — posting the count applies
    // the whole correction in one move. Doing both would take the same unit off
    // twice.
    // -----------------------------------------------------------------------
    const openLine = new Map<string, StockCountItem>(); // productId → line in an open count
    for (const c of db.stockCounts) {
      if (c.status === "Posted") continue;
      for (const it of c.items) {
        if (!it.countedAt) continue;
        const prev = openLine.get(it.productId);
        // Most recently counted line wins, if the product somehow sits in two.
        if (!prev || (prev.countedAt || "") < it.countedAt) openLine.set(it.productId, it);
      }
    }

    // -----------------------------------------------------------------------
    // Stock: take off what sold AFTER the shelf was counted.
    //
    // Selling happens in another POS, so nothing here ever empties a shelf —
    // stock only climbs (receiving) until a count resets it. This report is the
    // only way the app can learn what left the building.
    //
    // For a product that HAS a baseline (a posted count or an opening balance),
    // it must not deduct everything in the file, because the count has already
    // seen part of it. A bottle sold at 09:00 was already gone from the shelf
    // when the accountant counted at 10:00 — it's inside the counted number, and
    // taking it off again would remove it twice. A bottle sold at 11:00 was
    // still on the shelf when counted, so it has to come off. Hence for those
    // products: deduct a line only when it happened after that product's most
    // recent baseline. Which also means back-filling months of old history can't
    // crater a counted product — those sales predate the count, so they're
    // skipped by the same rule.
    //
    // For a product with NO baseline, there's nothing already reflecting the
    // sale, so the whole line comes off (handled below). That's what makes an
    // import always move stock even before the first count is posted.
    //
    // Only posted counts count as a baseline here: an open one hasn't touched
    // stock yet, so it isn't a baseline for anything.
    //
    // This also commutes with posting a count, which applies the variance it
    // found rather than setting stock outright. Post-then-import and
    // import-then-post land on the same number, so the office doesn't have to
    // get the order right.
    // -----------------------------------------------------------------------
    const lastCountAt = new Map<string, string>(); // productId → ISO instant
    for (const c of db.stockCounts) {
      if (c.status !== "Posted") continue;
      for (const it of c.items) {
        if (!it.countedAt) continue;
        const prev = lastCountAt.get(it.productId);
        if (!prev || it.countedAt > prev) lastCountAt.set(it.productId, it.countedAt);
      }
    }
    // An OPENING BALANCE is a baseline too — it IS a physical count, imported.
    // Without this, a freshly migrated store (opening posted, no stock count
    // yet) would have every sale skipped as "never counted" and stock would
    // sit at the opening figure forever.
    for (const l of db.ledger) {
      if (l.type !== "OPENING_BALANCE") continue;
      const prev = lastCountAt.get(l.productId);
      if (!prev || l.at > prev) lastCountAt.set(l.productId, l.at);
    }

    const stock = {
      deduct: new Map<string, number>(),
      linesReduced: 0,
      unitsReduced: 0,
      beforeCount: 0,
      neverCounted: 0,
      sameDayNoTime: 0,
      countedNow: 0, // units handed to an open count instead of deducted here
      countsTouched: new Set<string>(),
    };
    for (const row of toImport) {
      // --- In an open count? Reconcile into it, don't touch stock. ---
      const line = openLine.get(row.productId);
      if (line) {
        const at = row.time ? storeInstant(row.day, row.time) : null;
        if (!at) {
          // No clock on the row, so it can't be placed either side of the
          // count. Left for the count to handle as it stands, and reported.
          stock.sameDayNoTime++;
          continue;
        }
        // Compare to the minute the line was counted, not the second. The report
        // prints HH:MM while countedAt carries seconds, so a sale at 10:00 and a
        // count stamped 10:00:37 would read as "before" on a strict compare —
        // when the shop's own record says they happened in the same minute and
        // the unit is gone. Counting it as sold matches what's on the shelf.
        const countMinute = Math.floor(Date.parse(line.countedAt!) / 60000) * 60000;
        if (at.getTime() >= countMinute) {
          line.soldAfterCount = (line.soldAfterCount ?? 0) + row.qty;
          stock.countedNow += row.qty;
          const owner = db.stockCounts.find((c) => c.items.includes(line));
          if (owner) stock.countsTouched.add(owner.countNo);
        } else {
          // Sold before it was counted — the counted number already excludes it.
          stock.beforeCount++;
        }
        continue;
      }

      const countedAt = lastCountAt.get(row.productId);
      if (!countedAt) {
        // No baseline yet — no opening balance, no posted count — for this
        // product. A sales import must still reduce stock; that's the whole
        // point of importing it. With no count to say which units were already
        // reflected, the line comes straight off: stock follows what sold. If
        // the book never knew it had those units it goes negative, which the
        // inventory page surfaces as "set an opening balance to fix the book."
        stock.deduct.set(row.productId, (stock.deduct.get(row.productId) || 0) + row.qty);
        stock.linesReduced++;
        stock.unitsReduced += row.qty;
        continue;
      }
      let after: boolean;
      if (row.time) {
        const at = storeInstant(row.day, row.time);
        if (!at) {
          stock.sameDayNoTime++;
          continue;
        }
        after = at.getTime() > Date.parse(countedAt);
      } else {
        // No time on the row: settle it by day where the day alone is decisive.
        const countDay = storeToday(new Date(countedAt));
        if (row.day === countDay) {
          // Same day, no clock — can't tell which side of the count it fell.
          // Skipped: deducting a sale the count already saw is worse than
          // leaving stock high, because it silently invents shrinkage.
          stock.sameDayNoTime++;
          continue;
        }
        after = row.day > countDay;
      }
      if (!after) {
        stock.beforeCount++;
        continue;
      }
      stock.deduct.set(row.productId, (stock.deduct.get(row.productId) || 0) + row.qty);
      stock.linesReduced++;
      stock.unitsReduced += row.qty;
    }
    // One ledger line per product per file — the ref ties it to the upload.
    for (const [pid, qty] of stock.deduct) {
      const product = db.products.find((p) => p.id === pid);
      if (!product) continue;
      postLedger(db, product, { type: "SALES_IMPORT", qty: -qty, by: actor, ref: file.name || "POS report" });
    }

    // Group the new rows per day; remember which source invoices each day covers
    // so a later overlapping import can skip exactly these transactions.
    const byDay = new Map<string, { items: SaleItem[]; invoices: Set<string>; discount: number }>();
    for (const row of toImport) {
      const g = byDay.get(row.day) ?? byDay.set(row.day, { items: [], invoices: new Set(), discount: 0 }).get(row.day)!;
      g.items.push({ productId: row.productId, sku: row.sku, name: row.name, qty: row.qty, price: row.price, cost: row.cost });
      g.discount += row.discount;
      if (row.invoice) g.invoices.add(row.invoice);
    }

    let salesCreated = 0;
    for (const [day, g] of byDay) {
      const items = g.items;
      // Imported prices are VAT-INCLUSIVE (same as live sales): the line total is
      // what was paid; VAT is the portion already inside it. The report's Discount
      // column is money actually taken off, so it reduces the amount paid.
      const gross = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
      const cost = round2(items.reduce((s, it) => s + it.cost * it.qty, 0));
      const discount = round2(Math.min(g.discount, gross));
      const total = round2(gross - discount); // actually paid, after discount
      const subtotal = round2(total / (1 + db.meta.business.vatRate)); // net of VAT
      const tax = round2(total - subtotal); // VAT already contained in the price
      const invoiceNo = `INV-${db.meta.nextInvoice}`;
      const sale: Sale = {
        id: `s${db.meta.nextInvoice}`,
        invoiceNo,
        items,
        customerId: null,
        subtotal,
        discount,
        tax,
        total,
        cost,
        profit: round2(total - cost),
        paymentMethod: "Cash",
        // Noon UTC — the day is already a validated calendar date, and using UTC
        // means the stored date-part is exactly `day` on any server timezone.
        createdAt: new Date(`${day}T12:00:00Z`).toISOString(),
        imported: true,
        sourceInvoices: g.invoices.size ? [...g.invoices] : undefined,
      };
      db.meta.nextInvoice += 1;
      db.sales.push(sale);
      salesCreated++;
    }

    logAudit(db, {
      actor,
      action: "Imported",
      entityType: "Sale",
      entity: file.name || "Excel file",
      detail: `${toImport.length} lines · ${salesCreated} day-sales${
        skippedDuplicates ? ` · skipped ${skippedDuplicates} duplicate transaction(s) already on record` : ""
      }${stock.unitsReduced ? ` · stock -${stock.unitsReduced} units (sold after counting)` : ""}${
        stock.countedNow ? ` · ${stock.countedNow} units sold after counting → ${[...stock.countsTouched].join(", ")}` : ""
      }`,
    });
    return {
      matched: toImport.length,
      salesCreated,
      totalRows: rows.length,
      skippedDuplicates,
      skippedDates,
      stock: { ...stock, deduct: undefined, countsTouched: [...stock.countsTouched] },
    };
  });

  return NextResponse.json(result);
}
