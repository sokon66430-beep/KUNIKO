"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScanLine,
  Camera,
  Tag,
  Printer,
  Trash2,
  Plus,
  Minus,
  FileDown,
} from "lucide-react";
import JsBarcode from "jsbarcode";
import { useFetch } from "@/lib/client";
import { CameraScanner } from "@/components/CameraScanner";
import type { Product } from "@/lib/types";
import { PageHeader, Card, ErrorBox, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { usd } from "@/lib/format";

// ---------------------------------------------------------------------------
// Pricing rules (fixed by the business):
//   Riel price = USD × 4,100, then ALWAYS rounded UP to the next 100 riel.
//   e.g. $1.49 → 6,109៛ → 6,200៛   ·   $1.00 → 4,100៛ (already a clean 100)
// ---------------------------------------------------------------------------
const RIEL_RATE = 4100;
function rielPrice(usdPrice: number): number {
  const raw = usdPrice * RIEL_RATE;
  return Math.ceil(Math.round(raw) / 100) * 100; // round to riel first, then ceil to 100
}
const riel = (n: number) => n.toLocaleString("en-US");

type BatchLine = { product: Product; qty: number };

function today(): string {
  const d = new Date();
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const LABEL_FONT = `'Plus Jakarta Sans Variable','Segoe UI',sans-serif`;
const KHMER_FONT = `'Battambang','Khmer UI','Noto Sans Khmer','Leelawadee UI',sans-serif`;
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
}: {
  product: Product;
  kh?: string;
  mode?: NameMode;
  widthMm?: number;
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
      if ((p.barcode || "").includes(q)) return 0;
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
    setBatch((b) => {
      const existing = b.find((l) => l.product.id === p.id);
      if (existing) return b.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...b, { product: p, qty: 1 }];
    });
    setScan("");
    setNotice(null);
    scanRef.current?.focus();
  }

  function lookup(codeArg?: string) {
    const fromCamera = codeArg != null;
    const code = (codeArg ?? scan).trim();
    if (!code) return;
    const lc = code.toLowerCase();
    const match =
      list.find((p) => p.barcode === code) ||
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
        `<style>@page{size:A4 portrait;margin:8mm}html,body{margin:0;padding:0;background:#fff}` +
        `.label-sheet{display:flex;flex-wrap:wrap;gap:3mm}.label-card{outline:none!important;box-shadow:none!important}</style>` +
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
          subtitle="Scan or search a product, set how many labels, then print — ONMART shelf-label format"
          actions={
            <div className="flex items-center gap-2">
              <button className="btn-primary" disabled={totalLabels === 0 || pdfBusy} onClick={downloadPdf}>
                <FileDown size={18} /> {pdfBusy ? "Building…" : "Download PDF"}
              </button>
              <button className="btn-ghost" disabled={totalLabels === 0} onClick={printLabels}>
                <Printer size={18} /> Print
              </button>
            </div>
          }
        />

        {error && <ErrorBox message={error} />}

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
                        {p.nameKh ? <span className="ml-1.5 text-slate-500">· {p.nameKh}</span> : null}
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
            Riel price = USD × {riel(RIEL_RATE)}, always rounded up to the next 100៛. In <b>Khmer + English</b> the
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
              {batch.map(({ product: p, qty }) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-800">
                      {p.name}
                      {p.nameKh && <span className="ml-1.5 font-normal text-slate-500">· {p.nameKh}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {p.sku} · {usd(p.price)} → <span className="font-semibold text-brand-600">{riel(rielPrice(p.price))}៛</span>
                    </p>
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
              ))}
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
      </div>

      {/* The printable sheet: labels duplicated per requested qty */}
      <div className="overflow-x-auto">
        <div
          className="label-sheet grid"
          style={{ gridTemplateColumns: `repeat(${perRow}, ${layout.w}mm)`, gap: `${layout.gap}mm`, width: "max-content" }}
        >
          {batch.flatMap(({ product, qty }) =>
            Array.from({ length: qty }, (_, i) => (
              <PriceLabel
                key={`${product.id}-${i}`}
                product={product}
                kh={product.nameKh}
                mode={nameMode}
                widthMm={layout.w}
              />
            )),
          )}
        </div>
      </div>

      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => lookup(code)} />
    </div>
  );
}
