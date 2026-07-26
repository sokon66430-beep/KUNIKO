"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { matchesBarcode, barcodeIncludes } from "@/lib/barcodes";
import { Tag, Plus, Minus, Printer, ScanLine, Camera, Ban, TicketPercent, CalendarClock, CircleSlash } from "lucide-react";
import JsBarcode from "jsbarcode";
import { useFetch, api, useRole } from "@/lib/client";
import type { Product, Markdown } from "@/lib/types";
import { PageHeader, Card, StatCard, Spinner, ErrorBox, EmptyState, Badge } from "@/components/ui";
import { CameraScanner } from "@/components/CameraScanner";
import { DatePicker } from "@/components/DatePicker";
import { confirmDialog } from "@/components/confirm";
import { usd, rielShelfPrice } from "@/lib/format";
import { MARKDOWN_PERCENTS, markdownStatus, storeToday, daysLeft, type MarkdownStatus } from "@/lib/markdowns";
import { shortDay } from "@/lib/storetime";
import { canMarkDown } from "@/lib/access";
import { KHMER_FONT } from "@/lib/fonts";

const STATUS_TONE: Record<MarkdownStatus, "emerald" | "brand" | "slate" | "rose"> = {
  Active: "emerald",
  Scheduled: "brand",
  Expired: "slate",
  Cancelled: "rose",
};

// The printed sticker — the shelf price label's layout on the same 470 × 250
// design grid and the same 4.7 × 2.5cm stock, so it sits on the shelf looking
// like it belongs: name band on top, barcode band under it, blue footer.
//
// It differs where a markdown must: the band is RED (a reduced item has to read
// as reduced at a glance), the price shown is the cut one with the old one
// struck beside it, and the shelf-life line becomes the end date. The barcode is
// deliberately larger than the shelf label's — this is the code the till has to
// read off a sticker slapped on a curved bun bag, so bar width carries it.
const DESIGN_W = 470;
const DESIGN_H = 250;
// Same A4 sheet as the price labels: 4 across at 47mm, hairline gap, so both
// print on the identical label stock.
const PER_ROW = 4;
const LABEL_W_MM = 47;
const SHEET_GAP_MM = 0.5;
const SHEET_MARGIN_MM = 10.25;
// A ceiling so a stray keystroke in the qty box can't try to render thousands
// of barcodes and lock the tablet up.
const MAX_LABELS = 200;
const clampQty = (n: number) => Math.max(1, Math.min(MAX_LABELS, Math.floor(n) || 1));
const LABEL_FONT = `'Plus Jakarta Sans Variable','Segoe UI',sans-serif`;
const LABEL_RED = "#e11d48"; // markdown band — the shelf label's green means full price
const LABEL_BLUE = "#4a72c4"; // same footer strip as the shelf label
const rielNum = (n: number) => n.toLocaleString("en-US");

// Rendered at its true millimetre size, like the price label — the preview IS
// the printout, not a picture of one.
function PromoLabel({ m, widthMm = LABEL_W_MM }: { m: Markdown; widthMm?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const scale = (widthMm * 96) / 25.4 / DESIGN_W;
  const heightMm = +((widthMm * DESIGN_H) / DESIGN_W).toFixed(2);
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, m.code, {
        format: "CODE128",
        width: 3, // wider bars than the shelf label's 2 — what makes it scan
        height: 62,
        displayValue: true,
        font: LABEL_FONT,
        fontSize: 15,
        textAlign: "left",
        textMargin: 1,
        margin: 0,
      });
    } catch {
      /* unencodable — leave the barcode area blank rather than crash the sheet */
    }
  }, [m.code]);

  const kh = (m.nameKh || "").trim();
  return (
    <div
      className="promo-label overflow-hidden bg-white"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, breakInside: "avoid" }}
    >
      <div
        className="flex flex-col"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: LABEL_FONT,
        }}
      >
        {/* Red band — the shelf label's green band, in markdown colours */}
        <div
          className="flex h-[132px] items-start justify-between gap-3 overflow-hidden px-4 pt-2.5 text-white"
          style={{ backgroundColor: LABEL_RED }}
        >
          <div className="min-w-0 flex-1">
            {/* The cut is the whole point of the sticker — it has to carry
                across the aisle, so it's the biggest thing on this side. */}
            <p className="text-[38px] font-black leading-[40px] tracking-[-0.01em]">{m.percent}% OFF</p>
            {kh && (
              <p
                className="overflow-hidden text-[17px] font-bold leading-[21px]"
                style={{ fontFamily: KHMER_FONT, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
              >
                {kh}
              </p>
            )}
            <p
              className={`overflow-hidden font-bold ${kh ? "text-[14px] leading-[17px]" : "mt-0.5 text-[17px] leading-[21px]"}`}
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
            >
              {m.name}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end text-right">
            <p className="text-[46px] font-black leading-[48px] tracking-[-0.02em]">
              {rielNum(rielShelfPrice(m.price))}
              <span className="align-top text-[20px] font-bold" style={{ fontFamily: KHMER_FONT }}>
                ៛
              </span>
            </p>
            <p className="text-[24px] font-extrabold leading-[28px] tracking-[-0.01em]">{usd(m.price)}</p>
            <p className="text-[15px] font-bold leading-[19px] text-white/80 line-through">{usd(m.originalPrice)}</p>
          </div>
        </div>

        {/* White band — end date over the barcode · item code + ranking */}
        <div className="flex h-[104px] items-stretch justify-between gap-2 bg-white px-4 pb-1 pt-1">
          <div className="min-w-0">
            <p className="text-[15px] font-black leading-[18px] tracking-tight" style={{ color: LABEL_RED }}>
              ENDS {shortDay(m.endDate).toUpperCase()}
            </p>
            <svg ref={svgRef} className="h-[80px] max-w-[330px]" />
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between py-0.5 text-right text-black">
            <p className="text-[17px] font-bold leading-[21px] tracking-tight">{m.sku}</p>
            <p className="text-[20px] font-black leading-[22px]">{m.percent}%</p>
          </div>
        </div>

        {/* Blue footer strip — same as the shelf label */}
        <div className="h-[14px] w-full shrink-0" style={{ backgroundColor: LABEL_BLUE }} />
      </div>
    </div>
  );
}

export default function PromotionsPage() {
  const { data: markdowns, loading, error, reload } = useFetch<Markdown[]>("/api/markdowns");
  const { data: products } = useFetch<Product[]>("/api/products");
  const role = useRole();
  const mayDiscount = role ? canMarkDown(role) : false;

  // ONE discount and date range for the whole run — set once, then scan the
  // shelf of items that all get it. This is the bulk model: the manager decides
  // "everything I scan now is 50% off until Sunday", not item by item.
  const [percent, setPercent] = useState(MARKDOWN_PERCENTS[0]);
  const [startDate, setStartDate] = useState(storeToday());
  const [endDate, setEndDate] = useState(storeToday());
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Which existing label is shown in the sheet (from clicking a row). Held as a
  // CODE so it survives a reload instead of going stale.
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  // Labels made in this run — scanning an item discounts it on the spot, so
  // there's no pending queue to confirm.
  const [batch, setBatch] = useState<Markdown[]>([]);
  // Stickers to print PER label. Rarely is only one unit reduced, so each label
  // carries its own count rather than one number for the whole sheet.
  const [qtyByCode, setQtyByCode] = useState<Record<string, number>>({});
  // Products with a create in flight — a scanner can fire twice faster than the
  // list reloads, and without this the second request races the first.
  const inFlight = useRef<Set<string>>(new Set());

  // Today is resolved in the store's timezone, not the tablet's — a Sunmi with a
  // wrong clock shouldn't change which labels look live.
  const today = storeToday();

  // Supplier isn't copied onto the label — it's read from the product it points
  // at, so "which Autoshine items are reduced?" still answers correctly after a
  // supplier change syncs down from Master Data, instead of matching a snapshot
  // taken the day the label was made.
  const byProductId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);

  // The search box searches the whole CATALOG, not the promotions — it's the
  // way IN for the ~91 items with no barcode to scan. Typing shows product
  // matches; picking one adds it to the batch like a scan would.
  const productResults = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return (products || [])
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.nameKh || "").includes(needle) ||
          p.sku.toLowerCase().includes(needle) ||
          barcodeIncludes(p, needle) ||
          (p.supplier || "").toLowerCase().includes(needle) ||
          (p.supplierCode || "").toLowerCase().includes(needle) ||
          (p.category || "").toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [products, q]);

  // Which products already have a LIVE label — shown on search results so
  // "already reduced" is visible before you try to add it again.
  const liveByProductId = useMemo(() => {
    const map = new Map<string, Markdown>();
    for (const m of markdowns || []) {
      if (markdownStatus(m, today) === "Active" || markdownStatus(m, today) === "Scheduled") map.set(m.productId, m);
    }
    return map;
  }, [markdowns, today]);

  // Only labels still in play. A label that has finished, or been pulled early,
  // is history: its barcode is dead, there's nothing to print and nothing to
  // stop, so it can only pad the list staff have to read. It isn't deleted —
  // it moves to the Mark Down report, which is what that page is for.
  const rows = useMemo(() => {
    // Running now first — those are the ones staff act on.
    const rank: Record<MarkdownStatus, number> = { Active: 0, Scheduled: 1, Expired: 2, Cancelled: 3 };
    return [...(markdowns || [])]
      .filter((m) => {
        const s = markdownStatus(m, today);
        return s === "Active" || s === "Scheduled";
      })
      .sort((a, b) => {
        const d = rank[markdownStatus(a, today)] - rank[markdownStatus(b, today)];
        return d !== 0 ? d : +new Date(b.createdAt) - +new Date(a.createdAt);
      });
  }, [markdowns, today]);

  // A single label picked from the list (clicking a row). Only honoured while
  // it's still in the list, so searching past it doesn't strand a stale sheet.
  const preview = useMemo(() => {
    const picked = previewCode ? rows.find((m) => m.code === previewCode) : null;
    if (picked) return picked;
    return rows.length === 1 ? rows[0] : null;
  }, [previewCode, rows]);

  // What the sheet prints: the run just made if there is one, otherwise the
  // single picked label. The run wins so a shelf shows all at once.
  const sheetLabels = batch.length > 0 ? batch : preview ? [preview] : [];
  const sheetItems = sheetLabels.length;
  const qtyOf = (code: string) => qtyByCode[code] ?? 1;
  const setQtyFor = (code: string, n: number) => setQtyByCode((m) => ({ ...m, [code]: clampQty(n) }));
  const totalLabels = sheetLabels.reduce((s, m) => s + qtyOf(m.code), 0);

  // The list only holds live labels now, so anything you can pick is printable.
  const printable = batch.length > 0 || !!preview;

  const stats = useMemo(() => {
    const list = markdowns || [];
    const active = list.filter((m) => markdownStatus(m, today) === "Active");
    return {
      active: active.length,
      scheduled: list.filter((m) => markdownStatus(m, today) === "Scheduled").length,
      endingToday: active.filter((m) => m.endDate === today).length,
      // Expired AND pulled early. Both are done with, and both are exactly what
      // moved off this list into the report — so counting only expired ones here
      // would leave a number that doesn't match either list.
      finished: list.filter((m) => {
        const s = markdownStatus(m, today);
        return s === "Expired" || s === "Cancelled";
      }).length,
    };
  }, [markdowns, today]);

  // One scan path for the Sunmi's scanner, the camera and typing. Scanning an
  // item adds it to the batch under the current discount + dates. A promo
  // sticker (or an item already reduced) isn't added — it just filters the list
  // so you can see it. Anything else falls through to a plain search.
  function handleScan(code: string) {
    const c = code.trim();
    if (!c) return;
    setCameraOpen(false);
    const lc = c.toLowerCase();
    const list = products || [];
    const live = (markdowns || []).find(
      (m) => (m.productBarcode === c || m.sku.toLowerCase() === lc || m.code === c) && markdownStatus(m, today) === "Active",
    );
    if (live) {
      setQ(c); // show the existing one rather than making a duplicate
      setToast(`${live.name} is already ${live.percent}% off until ${shortDay(live.endDate)}.`);
      return;
    }
    // Barcode or item ID first. Failing that, a typed name counts too — fresh
    // food and made-to-order items carry no barcode at all. An exact name wins
    // outright: "Taro Bun" must find Taro Bun even though "Taro Bun v2" also
    // contains it; otherwise only an unambiguous partial.
    const named = list.filter((p) => p.name.toLowerCase().includes(lc));
    const prod =
      list.find((p) => matchesBarcode(p, c) || p.sku.toLowerCase() === lc) ??
      list.find((p) => p.name.toLowerCase() === lc) ??
      (named.length === 1 ? named[0] : undefined);
    if (!prod) {
      setQ(c); // no match — leave it in the box so the results panel says so
      return;
    }
    discountProduct(prod);
  }

  // Scanning or picking an item discounts it there and then: you don't open this
  // page unless you're marking something down, so a confirm step is a tap that
  // buys nothing. A mistake is undone with Stop on the row.
  async function discountProduct(prod: Product) {
    const live = liveByProductId.get(prod.id);
    if (live) {
      setToast(`${prod.name} is already ${live.percent}% off until ${shortDay(live.endDate)}.`);
      return;
    }
    if (!mayDiscount) {
      setToast("Ask a manager to discount it.");
      return;
    }
    if (inFlight.current.has(prod.id)) return; // a double-scan, not a second item
    inFlight.current.add(prod.id);
    setQ(""); // clear so the next scan starts clean
    try {
      const m = await api<Markdown>("/api/markdowns", {
        method: "POST",
        body: JSON.stringify({ productId: prod.id, percent, startDate, endDate }),
      });
      setBatch((b) => (b.some((x) => x.code === m.code) ? b : [...b, m]));
      setPreviewCode(null); // the run is what's on the sheet now
      reload();
      setToast(`${prod.name} — ${m.percent}% off at ${usd(m.price)}`);
    } catch (e: any) {
      setToast(e.message);
    } finally {
      inFlight.current.delete(prod.id);
    }
  }

  // The Sunmi L3 (and any USB wedge scanner) types the barcode in a fast burst
  // then sends Enter. Watching the whole page means staff can just scan — no
  // tapping into the search box first. The 120ms gap is what separates a
  // scanner's burst from human typing, so normal searching still works.
  const scanStateRef = useRef({ buf: "", last: 0 });
  const blockRef = useRef(false);
  // Only the camera overlay stands the wedge scanner down — everything else is
  // part of the page, so scanning a second item just discounts that one too.
  blockRef.current = cameraOpen;
  // The listener is attached ONCE and calls through this ref, so it always runs
  // the current handler. Binding handleScan directly would freeze the percent
  // and dates as they were when the effect last ran: change the cut to 50% and
  // the very next scan would still be discounted at 30%.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blockRef.current) return;
      const now = Date.now();
      const s = scanStateRef.current;
      if (now - s.last > 120) s.buf = "";
      s.last = now;
      if (e.key === "Enter") {
        const code = s.buf.trim();
        s.buf = "";
        if (code.length < 3) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handleScanRef.current(code);
        return;
      }
      if (e.key.length === 1) s.buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  async function stop(m: Markdown) {
    const ok = await confirmDialog({
      title: `Stop the ${m.percent}% label?`,
      message: `${m.name} goes back to ${usd(m.originalPrice)} straight away. Any ${m.code} stickers already on the shelf will stop scanning.`,
      confirmText: "Stop label",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/markdowns/${m.id}`, { method: "DELETE" });
      setToast(`${m.code} stopped.`);
      reload();
    } catch (e: any) {
      setToast(e.message);
    }
  }

  // Print the sheet through its own window, the way the price labels do: the
  // grid is restated in the print CSS so the paper lays out exactly like the
  // preview instead of being reflowed.
  function printSheet() {
    const sheet = document.querySelector(".promo-sheet");
    if (!sheet) return;
    const win = window.open("", "PRINT", "width=900,height=650");
    if (!win) {
      window.print(); // popups blocked — fall back to printing the page
      return;
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((n) => n.outerHTML)
      .join("\n");
    win.document.open();
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Discount Labels</title>${styles}` +
        `<style>@page{size:A4 portrait;margin:${SHEET_MARGIN_MM}mm}html,body{margin:0;padding:0;background:#fff}` +
        `.promo-sheet{display:grid!important;grid-template-columns:repeat(${PER_ROW}, ${LABEL_W_MM}mm)!important;` +
        `gap:${SHEET_GAP_MM}mm!important;width:max-content}` +
        `.promo-label{outline:none!important;box-shadow:none!important}</style>` +
        `</head><body>${sheet.outerHTML}</body></html>`,
    );
    win.document.close();
    win.onafterprint = () => win.close();
    const go = () => {
      win.focus();
      win.print();
    };
    // let fonts + stylesheets land before the dialog opens
    if (win.document.readyState === "complete") setTimeout(go, 400);
    else win.onload = () => setTimeout(go, 400);
  }

  return (
    <div>
      <PageHeader
        title="Mark Down"
        subtitle="Set a discount and dates, then scan the items — the barcodes stop working on the end date"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Running now" value={stats.active} icon={<TicketPercent size={18} />} accent="emerald" />
        <StatCard label="Starts later" value={stats.scheduled} icon={<CalendarClock size={18} />} accent="brand" />
        <StatCard label="Last day today" value={stats.endingToday} icon={<Tag size={18} />} accent="amber" />
        <StatCard label="Finished" value={stats.finished} sub="in the report" icon={<CircleSlash size={18} />} accent="violet" />
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
            <input
              className="input h-12 pl-10 pr-12 text-base"
              placeholder="Scan a barcode · or search any product by name, item ID, supplier, category…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                handleScan(q); // typed-in codes behave exactly like scanned ones
              }}
              inputMode="search"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              title="Scan with the camera"
              aria-label="Scan a barcode with the camera"
              className="absolute right-1.5 top-1/2 grid h-9 w-10 -translate-y-1/2 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              <Camera size={18} />
            </button>
          </div>

          {/* Catalog matches for what's typed — tapping one adds it to the batch
              exactly like scanning it. This is the path for the items that have
              no barcode to scan (fresh food, made-to-order). */}
          {q.trim().length >= 2 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              {productResults.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-400">No product matches “{q.trim()}”.</p>
              ) : (
                productResults.map((p) => {
                  const live = liveByProductId.get(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => discountProduct(p)}
                      className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-800">{p.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {p.sku}
                          {p.category ? ` · ${p.category}` : ""}
                          {p.supplier && p.supplier !== "—" ? ` · ${p.supplier}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-ink-900">{usd(p.price)}</span>
                      {live ? (
                        <Badge tone="amber">-{live.percent}% running</Badge>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand-600">
                          <Plus size={13} /> {percent}% off
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Bulk settings — set the cut and the dates ONCE, then scan the run
              of items. Every item you scan next gets these. */}
          {mayDiscount && (
            <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl bg-brand-50 p-4">
              <div>
                <label className="label">Discount</label>
                <div className="flex gap-1.5">
                  {MARKDOWN_PERCENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPercent(p)}
                      className={`h-11 min-w-[4rem] rounded-lg px-3 text-base font-black transition active:scale-[0.98] ${
                        percent === p ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Selling days</label>
                <div className="flex flex-wrap items-center gap-2">
                  <DatePicker
                    value={startDate}
                    min={today}
                    onChange={(v) => {
                      setStartDate(v);
                      if (endDate < v) setEndDate(v); // keep the range sane
                    }}
                  />
                  <span className="text-xs font-semibold text-slate-400">→</span>
                  <DatePicker value={endDate} min={startDate > today ? startDate : today} onChange={setEndDate} />
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Scan or search each item — it's discounted {percent}% on the spot, from {shortDay(startDate)} to{" "}
                {shortDay(endDate)}.
              </p>
            </div>
          )}

        </div>

        {loading ? (
          <Spinner label="Loading mark downs…" />
        ) : error ? (
          <ErrorBox message={error} />
        ) : rows.length === 0 ? (
          // An empty list means one of two different things, and telling a shop
          // "nothing marked down yet" when they ran twenty labels last week
          // reads as lost data rather than a finished job.
          stats.finished > 0 ? (
            <EmptyState
              title="No label running right now"
              hint={`${stats.finished} ${stats.finished === 1 ? "label has" : "labels have"} finished or been pulled. Scan an item above to reduce it, or look back at what the discounts cleared.`}
              icon={<CircleSlash size={18} />}
              action={
                <Link href="/markdown-reports" className="btn-ghost !py-2 text-sm">
                  Mark Down report
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="Nothing marked down yet"
              hint="Set the discount and dates above, then scan or search each item to reduce — each is discounted on the spot and gets its own barcode."
            />
          )
        ) : (
          <div className="space-y-2">
            {rows.map((m) => {
              const status = markdownStatus(m, today);
              const left = daysLeft(m, today);
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    setBatch([]);
                    setPreviewCode(m.code);
                  }}
                  className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border p-3 transition sm:p-4 ${
                    batch.length === 0 && preview?.code === m.code
                      ? "border-brand-300 bg-brand-50/40"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink-900 sm:text-base">{m.name}</p>
                      <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        -{m.percent}%
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      <span className="font-mono font-semibold text-slate-500">{m.code}</span> · {m.sku}
                      {m.category ? ` · ${m.category}` : ""}
                      {/* Shown because it's searchable — a supplier hit that
                          matched on nothing visible reads as a bug. */}
                      {byProductId.get(m.productId)?.supplier ? ` · ${byProductId.get(m.productId)!.supplier}` : ""}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-700">{usd(m.price)}</p>
                    <p className="text-[11px] text-slate-400 line-through">{usd(m.originalPrice)}</p>
                  </div>

                  <div className="w-28 text-right text-xs">
                    <p className="font-semibold text-slate-600">
                      {shortDay(m.startDate)} → {shortDay(m.endDate)}
                    </p>
                    <p className="text-slate-400">
                      {status === "Active"
                        ? left === 0
                          ? "Last day today"
                          : `${left} day${left === 1 ? "" : "s"} left`
                        : "Not started"}
                    </p>
                  </div>

                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <button
                      className="btn-ghost !py-2 flex-1 text-xs sm:flex-none"
                      onClick={() => {
                        setBatch([]);
                        setPreviewCode(m.code);
                      }}
                    >
                      <Printer size={14} /> Labels
                    </button>
                    {mayDiscount && (
                      <button
                        onClick={() => stop(m)}
                        aria-label={`Stop the ${m.percent}% label on ${m.name}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* The printable sheet — every label in the run, each printed `qty` times,
          laid out 4 across on A4 on the same stock and grid as the price labels.
          Real size, so the preview IS the printout. */}
      {sheetItems > 0 && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-ink-900">Labels to print</h3>
              <p className="text-xs text-slate-400">
                {sheetItems === 1 ? sheetLabels[0].name : `${sheetItems} items`} · {PER_ROW} across on A4 at 4.7 × 2.5
                cm — exactly what prints
              </p>
            </div>
            {printable ? (
              <button className="btn-primary !py-2 text-xs" onClick={printSheet}>
                <Printer size={14} /> Print {totalLabels}
              </button>
            ) : null}
          </div>

          {/* How many of each — several units of an item usually go on markdown,
              and they don't all need the same count, so the amount lives on the
              item rather than one number for the whole sheet. */}
          {printable && (
            <div className="mt-4 space-y-1.5">
              {sheetLabels.map((m) => (
                <div key={m.code} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-800">{m.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      <span className="font-mono">{m.code}</span> · {m.percent}% off ·{" "}
                      <span className="font-semibold text-amber-700">{usd(m.price)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setQtyFor(m.code, qtyOf(m.code) - 1)}
                      aria-label={`Fewer labels for ${m.name}`}
                      className="grid h-11 w-11 place-items-center rounded-lg bg-white text-slate-600 hover:bg-slate-100"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      className="input h-11 w-16 text-center text-sm font-bold"
                      type="number"
                      min={1}
                      max={MAX_LABELS}
                      value={qtyOf(m.code)}
                      onChange={(e) => setQtyFor(m.code, Number(e.target.value))}
                      aria-label={`How many labels for ${m.name}`}
                    />
                    <button
                      onClick={() => setQtyFor(m.code, qtyOf(m.code) + 1)}
                      aria-label={`More labels for ${m.name}`}
                      className="grid h-11 w-11 place-items-center rounded-lg bg-white text-slate-600 hover:bg-slate-100"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl bg-slate-50 p-4">
            <div
              className="promo-sheet grid"
              style={{
                gridTemplateColumns: `repeat(${PER_ROW}, ${LABEL_W_MM}mm)`,
                gap: `${SHEET_GAP_MM}mm`,
                width: "max-content",
              }}
            >
              {sheetLabels.flatMap((m) =>
                Array.from({ length: printable ? qtyOf(m.code) : 1 }, (_, i) => (
                  <PromoLabel key={`${m.code}-${i}`} m={m} />
                )),
              )}
            </div>
          </div>

          {batch.length > 0 ? (
            <p className="mt-3 text-xs text-slate-400">
              {sheetItems} item{sheetItems === 1 ? "" : "s"} discounted · {totalLabels} sticker
              {totalLabels === 1 ? "" : "s"} — set how many of each above.
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-400">
              One per reduced item — the rest of the shelf keeps selling at full price.
            </p>
          )}
        </Card>
      )}

      {/* Phone / tablet path — the Sunmi's own scanner needs no UI at all. */}
      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => handleScan(code)}
        hint="Point the camera at the item's barcode, or a discount sticker."
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-soft">
          {toast}
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
