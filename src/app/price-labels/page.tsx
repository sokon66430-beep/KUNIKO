"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { matchesBarcode, barcodeIncludes } from "@/lib/barcodes";
import {
  ScanLine,
  Camera,
  Tag,
  Printer,
  Trash2,
  Plus,
  Minus,
  FileDown,
  MapPin,
  Search,
  X,
} from "lucide-react";
import JsBarcode from "jsbarcode";
import { useFetch, api } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import type { Product } from "@/lib/types";
import { PageHeader, Card, ErrorBox, EmptyState, Badge } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { usd, num, rielShelfPrice, EXCHANGE_RATE } from "@/lib/format";
import { productLocations, formatLocation } from "@/lib/location";
import { KHMER_FONT } from "@/lib/fonts";

// Riel price = USD × 4,100 rounded UP to the next 100 riel — the rule now lives
// in lib/format (rielShelfPrice) so the promotion sticker rounds identically.
const rielPrice = rielShelfPrice;
const riel = (n: number) => n.toLocaleString("en-US");

type BatchLine = { product: Product; qty: number; gondola: string; shelf: string };

function today(): string {
  const d = new Date();
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const LABEL_FONT = `'Plus Jakarta Sans Variable','Segoe UI',sans-serif`;
const LABEL_BLUE = "#4a72c4"; // bottom strip
const LABEL_GREEN = "#b5cc18"; // top band

// One printed label — built on the designer's exact 470 × 250 canvas, then
// scaled to 4.7 × 2.5 cm. Working in the template's own pixel grid keeps every
// proportion (band heights, font sizes, spacing) identical to the reference.
//   GREEN BAND  · Khmer + English name left — big ៛ price right, USD under it
//   WHITE BAND  · date + S<shelf-life>D over the barcode — item code + ranking
//   BLUE STRIP  · footer
const DESIGN_W = 470;
const DESIGN_H = 250;
// 1mm = 96/25.4 CSS px, so 47mm ÷ 470px:
const LABEL_SCALE = (47 * 96) / 25.4 / DESIGN_W; // ≈ 0.3779

type NameMode = "kh-en" | "en";

function PriceLabel({
  product,
  kh: khOverride,
  mode = "kh-en",
  widthMm = 47,
  gondola: gondolaOverride,
  shelf: shelfOverride,
}: {
  product: Product;
  kh?: string;
  mode?: NameMode;
  widthMm?: number;
  gondola?: string;
  shelf?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const code = product.barcode || product.sku;
  const scale = (widthMm * 96) / 25.4 / DESIGN_W;
  const heightMm = (widthMm * DESIGN_H) / DESIGN_W;

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, code, {
        format: "CODE128",
        width: 2,
        height: 30,
        displayValue: true,
        font: LABEL_FONT,
        fontSize: 13,
        textAlign: "left", // barcode number sits to the left, under the first bars
        textMargin: 1,
        margin: 0,
      });
    } catch {
      /* unencodable value — leave the barcode area empty */
    }
  }, [code]);

  const kh = mode === "en" ? undefined : (khOverride ?? product.nameKh)?.trim();
  const gondola = (gondolaOverride ?? product.gondola ?? "").trim();
  const shelf = (shelfOverride ?? product.shelf ?? "").trim();
  return (
    <div className="label-card overflow-hidden bg-white" style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
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
        {/* Green band — 148/250 of the height, like the template */}
        <div
          className="flex h-[148px] items-start justify-between gap-3 overflow-hidden px-4 pt-3"
          style={{ backgroundColor: LABEL_GREEN }}
        >
          <div className="min-w-0 flex-1 pt-0.5">
            {kh && (
              <p
                className="overflow-hidden text-[25px] font-bold leading-[31px] text-black"
                style={{ fontFamily: KHMER_FONT, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}
              >
                {kh}
              </p>
            )}
            <p
              className={`overflow-hidden font-bold text-black/85 ${kh ? "text-[17px] leading-[21px]" : "mt-1 text-[24px] leading-[30px]"}`}
              style={{ display: "-webkit-box", WebkitLineClamp: kh ? 3 : 4, WebkitBoxOrient: "vertical" }}
            >
              {product.name}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end text-right text-black">
            <p className="text-[52px] font-black leading-[54px] tracking-[-0.02em]">
              {riel(rielPrice(product.price))}
              <span className="align-top text-[22px] font-bold" style={{ fontFamily: KHMER_FONT }}>
                ៛
              </span>
            </p>
            <p className="text-[26px] font-extrabold leading-[32px] tracking-[-0.01em]">{usd(product.price)}</p>
          </div>
        </div>

        {/* White band — date + shelf life over barcode · item code + ranking */}
        <div className="flex h-[88px] items-stretch justify-between gap-3 bg-white px-4 py-1.5">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-[19px] tracking-tight text-black">
              {today()}
              <span className="ml-3">S{product.shelfLifeDays || 0}D</span>
            </p>
            <svg ref={svgRef} className="h-[58px] max-w-[280px]" />
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between py-0.5 text-right text-black">
            <p className="text-[19px] font-bold leading-[23px] tracking-tight">{product.sku}</p>
            {(gondola || shelf) && (
              <p className="text-[13px] font-bold leading-[16px] tracking-tight text-black/85">
                {gondola ? `G${gondola}` : ""}
                {gondola && shelf ? " · " : ""}
                {shelf ? `SH${shelf}` : ""}
              </p>
            )}
            <p className="text-[22px] font-black leading-[24px]">{product.ranking || "A"}</p>
          </div>
        </div>

        {/* Blue footer strip */}
        <div className="h-[14px] w-full shrink-0" style={{ backgroundColor: LABEL_BLUE }} />
      </div>
    </div>
  );
}

export default function PriceLabelsPage() {
  const { data: products, error } = useFetch<Product[]>("/api/products");
  const [scan, setScan] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchLine[]>([]);
  const [nameMode, setNameMode] = useState<NameMode>("kh-en"); // what shows on the label
  const [perRow, setPerRow] = useState<4 | 5>(4); // labels across an A4 page
  const [pdfBusy, setPdfBusy] = useState(false);
  // Current shelf location — set this BEFORE scanning; every item scanned in
  // takes this Gondola/Shelf. Change it when you move to the next shelf.
  const [curGondola, setCurGondola] = useState("");
  const [curShelf, setCurShelf] = useState("");
  // Two jobs on one page: build the labels, or look up where things live.
  const [tab, setTab] = useState<"labels" | "locations">("labels");
  const scanRef = useRef<HTMLInputElement>(null);

  // Label width (mm) + a 1mm gap so there's a thin line to cut between labels
  // with scissors. Margin centers the block on A4. 4 = exact 4.7 cm spec.
  const LAYOUT = { 4: { w: 47, margin: 10.25, gap: 0.5 }, 5: { w: 37.5, margin: 9, gap: 0.5 } } as const;
  const layout = LAYOUT[perRow];
  const labelH = +((layout.w * 250) / 470).toFixed(2);

  const list = products || [];

  const searchResults = useMemo(() => {
    const q = scan.trim().toLowerCase();
    if (q.length < 2) return [];
    const score = (p: Product) => {
      if (barcodeIncludes(p, q)) return 0;
      if (p.sku.toLowerCase().includes(q)) return 1;
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) return 2;
      if (n.includes(q) || (p.nameKh || "").includes(scan.trim())) return 3;
      // also match by supplier name / code so you can pull a supplier's items
      if ((p.supplier || "").toLowerCase().includes(q) || (p.supplierCode || "").toLowerCase().includes(q)) return 4;
      return -1;
    };
    return list
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, 12)
      .map((x) => x.p);
  }, [scan, list]);

  function addProduct(p: Product) {
    const alreadyInBatch = batch.some((l) => l.product.id === p.id);
    setBatch((b) => {
      const existing = b.find((l) => l.product.id === p.id);
      // Keep the list in SCAN ORDER so the labels print in the exact order you
      // build the list, top-to-bottom. Re-scanning bumps qty in place (doesn't
      // reshuffle the row); a new item is appended to the bottom.
      if (existing) {
        return b.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...b,
        { product: p, qty: 1, gondola: curGondola || p.gondola || "", shelf: curShelf || p.shelf || "" },
      ];
    });
    // Scanning with a shelf location set at the top REGISTERS that location on
    // the product, so it's remembered everywhere (stock count, etc.) — not just
    // printed on this label. Only when it's new to the batch and actually
    // changes something.
    if (!alreadyInBatch && (curGondola || curShelf)) {
      const gondola = curGondola || p.gondola || "";
      const shelf = curShelf || p.shelf || "";
      if (gondola !== (p.gondola || "") || shelf !== (p.shelf || "")) {
        saveLocation({ product: p, qty: 1, gondola, shelf });
      }
    }
    setScan("");
    setNotice(null);
    scanRef.current?.focus();
  }

  // Update a label's Gondola/Shelf, and remember it on the product so it
  // pre-fills next time and shows the same location everywhere.
  function setLocation(id: string, field: "gondola" | "shelf", value: string) {
    setBatch((b) => b.map((l) => (l.product.id === id ? { ...l, [field]: value } : l)));
  }
  function saveLocation(line: BatchLine) {
    if (!line.gondola && !line.shelf) return;
    // Register this spot on the product (kept alongside any other spots), so a
    // product in several places remembers them all.
    api(`/api/products/${line.product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ addLocation: { gondola: line.gondola, shelf: line.shelf } }),
    }).catch(() => {
      /* best-effort — the label still prints what was typed */
    });
  }

  function lookup(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? scan).trim();
    if (!code) return;
    const lc = code.toLowerCase();
    const match =
      list.find((p) => matchesBarcode(p, code)) ||
      list.find((p) => p.sku.toLowerCase() === lc) ||
      list.find((p) => p.name.toLowerCase() === lc) ||
      searchResults[0];
    if (match) {
      if (fromCamera) setCameraOpen(false);
      addProduct(match);
    } else {
      setNotice(`No product found for “${code}”.`);
    }
  }

  const setQty = (id: string, qty: number) =>
    setBatch((b) => b.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  const remove = (id: string) => setBatch((b) => b.filter((l) => l.product.id !== id));

  const totalLabels = batch.reduce((s, l) => s + l.qty, 0);

  // Build a real PDF of the labels (works everywhere — no browser print needed).
  // Each on-screen label is captured to an image, then laid out 3-per-row on A4
  // at the exact 47 × 25 mm size, and downloaded.
  async function downloadPdf() {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".label-sheet .label-card"));
    if (!cards.length) return;
    setPdfBusy(true);
    try {
      const { toPng } = await import("html-to-image");
      const { PDFDocument } = await import("pdf-lib");
      await (document as any).fonts?.ready; // make sure fonts are loaded before capture

      // Capture the FULL-resolution design (470×250) with its shrink transform
      // removed, so the PDF gets crisp detail instead of an upscaled thumbnail.
      const shots: string[] = [];
      for (const c of cards) {
        const inner = (c.firstElementChild as HTMLElement) || c;
        const opts = {
          pixelRatio: 3,
          backgroundColor: "#ffffff",
          width: 470,
          height: 250,
          style: { transform: "none", transformOrigin: "top left", margin: "0" },
        };
        await toPng(inner, opts); // warm-up pass (font race)
        shots.push(await toPng(inner, opts));
      }

      const mm = (v: number) => (v * 72) / 25.4;
      const A4W = mm(210);
      const A4H = mm(297);
      const M = mm(layout.margin);
      const LW = mm(layout.w);
      const LH = mm(labelH);
      const GAP = mm(layout.gap);
      const cols = perRow;
      const rowsPerPage = Math.max(1, Math.floor((A4H - 2 * M + GAP) / (LH + GAP)));
      const perPage = cols * rowsPerPage;

      const pdf = await PDFDocument.create();
      let page = pdf.addPage([A4W, A4H]);
      for (let i = 0; i < shots.length; i++) {
        if (i > 0 && i % perPage === 0) page = pdf.addPage([A4W, A4H]);
        const j = i % perPage;
        const col = j % cols;
        const row = Math.floor(j / cols);
        const x = M + col * (LW + GAP);
        const y = A4H - M - row * (LH + GAP) - LH;
        const png = await pdf.embedPng(shots[i]);
        page.drawImage(png, { x, y, width: LW, height: LH });
      }

      const bytes = await pdf.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const pad = (x: number) => String(x).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `price-labels-${stamp}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) {
      alert("Could not build the PDF: " + (e?.message || e));
    } finally {
      setPdfBusy(false);
    }
  }

  // Print the labels in a clean, isolated document so every browser (and the
  // shop's label/PDF printer) gets a proper preview and exact output. The label
  // sheet is already fully rendered in the DOM (barcodes included), so we copy
  // it — plus the app's styles — into a fresh window and print that.
  function printLabels() {
    const sheet = document.querySelector(".label-sheet");
    if (!sheet) return;
    const win = window.open("", "PRINT", "width=900,height=650");
    if (!win) {
      window.print(); // popups blocked — fall back to normal print
      return;
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((n) => n.outerHTML)
      .join("\n");
    win.document.open();
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Price Labels</title>${styles}` +
        `<style>@page{size:A4 portrait;margin:${layout.margin}mm}html,body{margin:0;padding:0;background:#fff}` +
        // Same grid as the on-screen preview — fixed columns/width/gap — so the
        // printed sheet lays out EXACTLY like the preview (not reflowed by flex).
        `.label-sheet{display:grid!important;grid-template-columns:repeat(${perRow}, ${layout.w}mm)!important;` +
        `gap:${layout.gap}mm!important;width:max-content}` +
        `.label-card{outline:none!important;box-shadow:none!important}</style>` +
        `</head><body>${sheet.outerHTML}</body></html>`,
    );
    win.document.close();
    win.onafterprint = () => win.close();
    const go = () => {
      win.focus();
      win.print();
    };
    // give fonts + stylesheets a moment to apply before printing
    if (win.document.readyState === "complete") setTimeout(go, 400);
    else win.onload = () => setTimeout(go, 400);
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Price Labels"
          subtitle={
            tab === "labels"
              ? "Scan or search a product, set how many labels, then print — ONMART shelf-label format"
              : "Every product registered to a shelf — where it is, and what's on each gondola"
          }
          actions={
            // Only on the Labels tab: printing an empty sheet from the Location
            // tab isn't a thing anyone wants, and a permanently-disabled button
            // reads as broken rather than as not-applicable.
            tab === "labels" ? (
              <div className="flex items-center gap-2">
                <button className="btn-primary" disabled={totalLabels === 0 || pdfBusy} onClick={downloadPdf}>
                  <FileDown size={18} /> {pdfBusy ? "Building…" : "Download PDF"}
                </button>
                <button className="btn-ghost" disabled={totalLabels === 0} onClick={printLabels}>
                  <Printer size={18} /> Print
                </button>
              </div>
            ) : null
          }
        />

        {error && <ErrorBox message={error} />}

        {/* Two jobs on one page: make the labels, or look up where things live.
            Tabs rather than one long scroll — the label sheet runs to dozens of
            items, and the shelf map was stranded underneath it. */}
        <div className="mb-5 inline-flex rounded-xl bg-slate-100 p-1">
          {(
            [
              { key: "labels", label: "Price Label", icon: <Tag size={15} /> },
              { key: "locations", label: "Location", icon: <MapPin size={15} /> },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                tab === t.key ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "locations" && <RegisteredLocations products={list} />}

        {tab === "labels" && (
          <>
        {/* Scan / search */}
        <Card className="mb-6">
          <label className="label flex items-center gap-1.5">
            <ScanLine size={13} /> Scan or search a product to add
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
            <input
              ref={scanRef}
              autoFocus
              className="input h-12 pl-10 pr-12 text-base"
              placeholder="Scan / type barcode · Item ID · name"
              value={scan}
              onChange={(e) => {
                setScan(e.target.value);
                setNotice(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookup();
                }
              }}
            />
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              title="Scan with camera"
              className="absolute right-1.5 top-1/2 grid h-9 w-10 -translate-y-1/2 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              <Camera size={18} />
            </button>
            {searchResults.length > 0 && (
              <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-soft">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center justify-between gap-3 border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-800">
                        {p.name}
                        {p.nameKh ? <span className="ml-1.5 text-slate-500" style={{ fontFamily: KHMER_FONT }}>· {p.nameKh}</span> : null}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {p.barcode || "no barcode"} · {p.sku} · {usd(p.price)}
                        {p.supplierCode ? ` · ${p.supplier}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-brand-600">
                      {riel(rielPrice(p.price))}៛
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {notice && <p className="mt-2 text-xs font-medium text-amber-600">{notice}</p>}

          {/* Shelf location — fill this FIRST, then scan; every item scanned in
              takes this Gondola/Shelf. Change it when you move to the next shelf. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-50/60 px-3.5 py-2.5 ring-1 ring-brand-100">
            <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Item location</span>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Gondola
              <input
                className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-bold text-ink-900 outline-none focus:border-brand-500"
                value={curGondola}
                onChange={(e) => setCurGondola(e.target.value)}
                placeholder="A12"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Shelf
              <input
                className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-bold text-ink-900 outline-none focus:border-brand-500"
                value={curShelf}
                onChange={(e) => setCurShelf(e.target.value)}
                placeholder="3"
              />
            </label>
            <span className="ml-auto text-[11px] text-slate-500">Fill first, then scan — every item you scan gets this spot</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Per row:</span>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {([4, 5] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPerRow(n)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      perRow === n ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {n}
                    {n === 5 ? " (smaller)" : ""}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Label name:</span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {(
                [
                  { key: "kh-en", label: "Khmer + English" },
                  { key: "en", label: "English only" },
                ] as { key: NameMode; label: string }[]
              ).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setNameMode(o.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    nameMode === o.key ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Riel price = USD × {riel(EXCHANGE_RATE)}, always rounded up to the next 100៛. In <b>Khmer + English</b> the
            label prints the Khmer name you provide (import the <b>Name KH</b> column in Excel, or Edit Product) with
            English under it; <b>English only</b> prints just the English name.
          </p>
        </Card>

        {/* Batch list */}
        {batch.length > 0 && (
          <Card className="mb-6 p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
                <Tag size={15} className="text-brand-600" /> Labels to print
              </h3>
              <button
                className="text-xs font-semibold text-rose-500 hover:underline"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: "Clear all labels",
                      message: `Remove all ${totalLabels} label${totalLabels === 1 ? "" : "s"} from the list?`,
                      confirmText: "Clear all",
                      cancelText: "Keep",
                    })
                  )
                    setBatch([]);
                }}
              >
                Clear all
              </button>
            </div>
            <ul className="divide-y divide-slate-50">
              {batch.map((line) => {
                const { product: p, qty } = line;
                return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-800">
                      {p.name}
                      {p.nameKh && <span className="ml-1.5 font-normal text-slate-500" style={{ fontFamily: KHMER_FONT }}>· {p.nameKh}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {p.sku} · {usd(p.price)} → <span className="font-semibold text-brand-600">{riel(rielPrice(p.price))}៛</span>
                    </p>
                  </div>
                  {/* Gondola + Shelf — type the placement; it prints on the label and saves to the product */}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                      Gondola
                      <input
                        className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm font-bold text-ink-900 outline-none focus:border-brand-500"
                        value={line.gondola}
                        onChange={(e) => setLocation(p.id, "gondola", e.target.value)}
                        onBlur={() => saveLocation({ ...line, gondola: line.gondola })}
                        placeholder="A12"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                      Shelf
                      <input
                        className="h-8 w-14 rounded-lg border border-slate-200 px-2 text-center text-sm font-bold text-ink-900 outline-none focus:border-brand-500"
                        value={line.shelf}
                        onChange={(e) => setLocation(p.id, "shelf", e.target.value)}
                        onBlur={() => saveLocation({ ...line, shelf: line.shelf })}
                        placeholder="3"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => setQty(p.id, qty - 1)}>
                      <Minus size={13} />
                    </button>
                    <input
                      className="h-8 w-14 rounded-lg border border-slate-200 text-center text-sm font-bold text-ink-900 outline-none focus:border-brand-500"
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(p.id, Number(e.target.value) || 1)}
                    />
                    <button className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => setQty(p.id, qty + 1)}>
                      <Plus size={13} />
                    </button>
                  </div>
                  <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => remove(p.id)}>
                    <Trash2 size={15} />
                  </button>
                </li>
                );
              })}
            </ul>
          </Card>
        )}

        {batch.length === 0 && (
          <Card>
            <EmptyState title="No labels yet" hint="Scan a barcode or search a product above — each one becomes a printable shelf label." />
          </Card>
        )}

        {batch.length > 0 && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Preview — exactly what prints</p>
        )}
          </>
        )}
      </div>

      {/* The printable sheet: labels duplicated per requested qty. Hidden on the
          Location tab — it's the print target, so leaving it mounted there would
          hang a sheet of labels under a shelf map. */}
      <div className={`overflow-x-auto ${tab === "labels" ? "" : "hidden"}`}>
        <div
          className="label-sheet grid"
          style={{ gridTemplateColumns: `repeat(${perRow}, ${layout.w}mm)`, gap: `${layout.gap}mm`, width: "max-content" }}
        >
          {batch.flatMap(({ product, qty, gondola, shelf }) =>
            Array.from({ length: qty }, (_, i) => (
              <PriceLabel
                key={`${product.id}-${i}`}
                product={product}
                kh={product.nameKh}
                mode={nameMode}
                widthMm={layout.w}
                gondola={gondola}
                shelf={shelf}
              />
            )),
          )}
        </div>
      </div>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => lookup(code)} />
    </div>
  );
}

/**
 * Everything registered on a shelf, read back.
 *
 * This page has always been able to SET a location — type a Gondola/Shelf,
 * scan, and it's saved onto the product — but there was nowhere to read it
 * back, so "what's on G12?" or "did that item ever get registered?" had no
 * answer short of opening products one at a time.
 *
 * Grouped Gondola → Shelf because that's the shape of the question: you're
 * standing at a shelf asking what belongs on it. A product registered in two
 * places appears under both — that's not duplication, it's where it is.
 */
function RegisteredLocations({ products }: { products: Product[] }) {
  const [q, setQ] = useState("");

  // One row per product PER PLACE it sits.
  const placed = useMemo(() => {
    const rows: { product: Product; gondola: string; shelf: string }[] = [];
    for (const p of products) {
      for (const l of productLocations(p)) {
        const gondola = (l.gondola || "").trim();
        const shelf = (l.shelf || "").trim();
        if (gondola || shelf) rows.push({ product: p, gondola, shelf });
      }
    }
    return rows;
  }, [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return placed;
    return placed.filter(
      (r) =>
        r.product.name.toLowerCase().includes(needle) ||
        (r.product.nameKh || "").includes(needle) ||
        r.product.sku.toLowerCase().includes(needle) ||
        barcodeIncludes(r.product, needle) ||
        r.gondola.toLowerCase().includes(needle) ||
        r.shelf.toLowerCase().includes(needle) ||
        `${r.gondola}/${r.shelf}`.toLowerCase().includes(needle),
    );
  }, [placed, q]);

  // Gondola → Shelf → products. Sorted naturally, so G2 comes before G10 —
  // plain string sort walks the aisle in the wrong order.
  const grouped = useMemo(() => {
    const byGondola = new Map<string, Map<string, typeof filtered>>();
    for (const r of filtered) {
      const g = r.gondola || "—";
      const s = r.shelf || "—";
      if (!byGondola.has(g)) byGondola.set(g, new Map());
      const shelves = byGondola.get(g)!;
      if (!shelves.has(s)) shelves.set(s, []);
      shelves.get(s)!.push(r);
    }
    const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    return [...byGondola.entries()].sort((a, b) => natural(a[0], b[0])).map(([gondola, shelves]) => ({
      gondola,
      shelves: [...shelves.entries()].sort((a, b) => natural(a[0], b[0])).map(([shelf, items]) => ({
        shelf,
        items: [...items].sort((a, b) => a.product.name.localeCompare(b.product.name)),
      })),
    }));
  }, [filtered]);

  /** The product's other shelves — the row already says the one it's under. */
  const elsewhere = (r: { product: Product; gondola: string; shelf: string }) =>
    productLocations(r.product)
      .filter((l) => (l.gondola || "").trim() !== r.gondola || (l.shelf || "").trim() !== r.shelf)
      .map(formatLocation)
      .filter(Boolean)
      .join(", ");

  const gondolaCount = useMemo(() => new Set(placed.map((r) => r.gondola || "—")).size, [placed]);
  const productCount = useMemo(() => new Set(placed.map((r) => r.product.id)).size, [placed]);
  const unregistered = products.length - productCount;

  return (
    <Card className="mb-6">
      {/* No collapse toggle: this is its own tab now, and you don't click
          "Location" to then be asked whether you'd like to see the locations. */}
      <div className="flex w-full items-center justify-between gap-3 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
            <MapPin size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-ink-900">Registered Locations</p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {productCount === 0
                ? "Nothing registered yet — set a Gondola/Shelf on the Price Label tab, then scan."
                : `${num(productCount)} product${productCount === 1 ? "" : "s"} across ${num(gondolaCount)} gondola${gondolaCount === 1 ? "" : "s"}`}
              {unregistered > 0 && productCount > 0 ? ` · ${num(unregistered)} with no location` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a product, or a gondola / shelf — e.g. G12, or 12/3…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
            {q && (
              <button onClick={() => setQ("")} className="shrink-0 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {grouped.length === 0 ? (
            <EmptyState
              title={placed.length === 0 ? "No shelf locations registered yet" : `Nothing matches “${q.trim()}”`}
              hint={
                placed.length === 0
                  ? "On the Price Label tab, type a Gondola and Shelf, then scan the items on it — each scan registers that spot on the product."
                  : "Search by product name, item ID, barcode, or a gondola / shelf."
              }
              icon={<MapPin size={18} />}
            />
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.gondola}>
                  <div className="mb-2 flex items-center gap-2">
                    <p className="text-[13px] font-bold text-ink-900">
                      Gondola <span className="font-mono">{g.gondola}</span>
                    </p>
                    <Badge tone="muted">
                      {num(g.shelves.reduce((s, sh) => s + sh.items.length, 0))} item
                      {g.shelves.reduce((s, sh) => s + sh.items.length, 0) === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {g.shelves.map((sh) => (
                      <div key={sh.shelf} className="rounded-xl border border-slate-200">
                        <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-slate-500">
                          Shelf <span className="font-mono normal-case text-ink-800">{sh.shelf}</span>
                        </p>
                        <ul className="divide-y divide-slate-50">
                          {sh.items.map((r) => (
                            <li key={`${r.product.id}-${r.gondola}-${r.shelf}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-ink-900">{r.product.name}</span>
                                <span className="block truncate text-[11.5px] text-slate-400">
                                  {r.product.sku}
                                  {r.product.barcode ? ` · ${r.product.barcode}` : ""}
                                  {/* The OTHER places it sits, so a product on
                                      two shelves says so from either one.
                                      "Also at" must exclude the shelf you're
                                      reading it under — telling someone stood
                                      at G2/5 that it's also at G2/5 is noise. */}
                                  {elsewhere(r) ? ` · also at ${elsewhere(r)}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-600">
                                {usd(r.product.price)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </Card>
  );
}
