"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Tag, Plus, Printer, ScanLine, Camera, Ban, TicketPercent, CalendarClock, CircleSlash } from "lucide-react";
import JsBarcode from "jsbarcode";
import { useFetch, api, useRole } from "@/lib/client";
import type { Product, Markdown } from "@/lib/types";
import { PageHeader, Card, StatCard, Spinner, ErrorBox, EmptyState, Badge, Modal } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { CameraScanner } from "@/components/CameraScanner";
import { DatePicker } from "@/components/DatePicker";
import { confirmDialog } from "@/components/confirm";
import { usd, rielShelfPrice } from "@/lib/format";
import {
  MARKDOWN_PERCENTS,
  markdownPrice,
  markdownStatus,
  storeToday,
  daysLeft,
  type MarkdownStatus,
} from "@/lib/markdowns";
import { canMarkDown } from "@/lib/access";

const STATUS_TONE: Record<MarkdownStatus, "emerald" | "brand" | "slate" | "rose"> = {
  Active: "emerald",
  Scheduled: "brand",
  Expired: "slate",
  Cancelled: "rose",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-07-16" → "16 Jul". Built from the string, not a Date, so the label never
// shifts a day when the device's timezone differs from the store's.
function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
}

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
const LABEL_SCALE = (47 * 96) / 25.4 / DESIGN_W;
const LABEL_FONT = `'Plus Jakarta Sans Variable','Segoe UI',sans-serif`;
const KHMER_FONT = `'Battambang','Khmer UI','Noto Sans Khmer','Leelawadee UI',sans-serif`;
const LABEL_RED = "#e11d48"; // markdown band — the shelf label's green means full price
const LABEL_BLUE = "#4a72c4"; // same footer strip as the shelf label
const rielNum = (n: number) => n.toLocaleString("en-US");

// zoom only blows it up for reading on screen — print always renders at 1, the
// true 4.7 × 2.5cm, so what you see is exactly what the printer puts out.
function PromoLabel({ m, zoom = 1 }: { m: Markdown; zoom?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
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
      style={{
        width: DESIGN_W * LABEL_SCALE * zoom,
        height: DESIGN_H * LABEL_SCALE * zoom,
        breakInside: "avoid",
      }}
    >
      <div
        className="flex flex-col"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${LABEL_SCALE * zoom})`,
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
            <p className="text-[20px] font-black leading-[24px] tracking-[0.02em]">{m.percent}% OFF</p>
            {kh && (
              <p
                className="overflow-hidden text-[19px] font-bold leading-[24px]"
                style={{ fontFamily: KHMER_FONT, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
              >
                {kh}
              </p>
            )}
            <p
              className={`overflow-hidden font-bold ${kh ? "text-[15px] leading-[19px]" : "mt-0.5 text-[20px] leading-[25px]"}`}
              style={{ display: "-webkit-box", WebkitLineClamp: kh ? 2 : 3, WebkitBoxOrient: "vertical" }}
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

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [printing, setPrinting] = useState<Markdown | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Which label is shown in the preview panel. Held as a CODE, not the object,
  // so the panel follows the record across a reload instead of going stale.
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  // A scanned item that has no label running — the offer to make one.
  const [scanned, setScanned] = useState<Product | null>(null);
  // Product to pre-fill the New-discount form with (set when you scan an item
  // that isn't on promotion, so the register step is one tap).
  const [preset, setPreset] = useState<string>("");

  // Today is resolved in the store's timezone, not the tablet's — a Sunmi with a
  // wrong clock shouldn't change which labels look live.
  const today = storeToday();

  // Supplier isn't copied onto the label — it's read from the product it points
  // at, so "which Autoshine items are reduced?" still answers correctly after a
  // supplier change syncs down from Master Data, instead of matching a snapshot
  // taken the day the label was made.
  const byProductId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);

  const rows = useMemo(() => {
    const list = markdowns || [];
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? list.filter((m) => {
          const p = byProductId.get(m.productId);
          return (
            m.name.toLowerCase().includes(needle) ||
            m.code.includes(needle) ||
            m.sku.toLowerCase().includes(needle) ||
            // The item's own shelf barcode too — scanning the product (not the
            // promo sticker) is how staff check "is this one reduced?"
            (m.productBarcode || "").includes(needle) ||
            (m.category || "").toLowerCase().includes(needle) ||
            (p?.supplier || "").toLowerCase().includes(needle) ||
            (p?.supplierCode || "").toLowerCase().includes(needle) ||
            (p?.nameKh || "").includes(needle)
          );
        })
      : list;
    // Live labels first — those are the ones staff act on.
    const rank: Record<MarkdownStatus, number> = { Active: 0, Scheduled: 1, Expired: 2, Cancelled: 3 };
    return [...matched].sort((a, b) => {
      const d = rank[markdownStatus(a, today)] - rank[markdownStatus(b, today)];
      return d !== 0 ? d : +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [markdowns, byProductId, q, today]);

  // The label on show: the picked one, else the only row on screen — so a scan
  // that narrows to one item puts its sticker up with nothing else to tap.
  // A pick is only honoured while it's still IN the list: searching past it must
  // not leave the panel showing a label the list no longer has.
  const preview = useMemo(() => {
    const picked = previewCode ? rows.find((m) => m.code === previewCode) : null;
    if (picked) return picked;
    return rows.length === 1 ? rows[0] : null;
  }, [previewCode, rows]);

  const stats = useMemo(() => {
    const list = markdowns || [];
    const active = list.filter((m) => markdownStatus(m, today) === "Active");
    return {
      active: active.length,
      scheduled: list.filter((m) => markdownStatus(m, today) === "Scheduled").length,
      endingToday: active.filter((m) => m.endDate === today).length,
      expired: list.filter((m) => markdownStatus(m, today) === "Expired").length,
    };
  }, [markdowns, today]);

  // One scan path for all three inputs: the Sunmi's built-in scanner, a phone
  // camera, and typing. Scanning the promo sticker finds that label; scanning
  // the ITEM finds any label on it — and if there's none, offers to make one,
  // which is the "register the product" step done in a single tap.
  function handleScan(code: string) {
    const c = code.trim();
    if (!c) return;
    setQ(c);
    setCameraOpen(false);
    const lc = c.toLowerCase();
    const list = products || [];
    // Barcode or item ID first. Failing that, a typed name counts too — fresh
    // food and made-to-order items carry no barcode at all, and scanning is now
    // the only way in, so they'd otherwise be impossible to discount.
    // An exact name wins outright: "Taro Bun" must find Taro Bun even though
    // "Taro Bun v2" also contains it. Otherwise only an unambiguous partial.
    const named = list.filter((p) => p.name.toLowerCase().includes(lc));
    const prod =
      list.find((p) => p.barcode === c || p.sku.toLowerCase() === lc) ??
      list.find((p) => p.name.toLowerCase() === lc) ??
      (named.length === 1 ? named[0] : undefined);
    const live = (markdowns || []).find(
      (m) => (m.productBarcode === c || m.sku.toLowerCase() === lc || m.code === c) && markdownStatus(m, today) === "Active",
    );
    if (prod && !live) {
      setScanned(prod);
    } else {
      setScanned(null);
      if (live) setToast(`${live.name} is ${live.percent}% off until ${shortDay(live.endDate)}.`);
    }
  }

  // The Sunmi L3 (and any USB wedge scanner) types the barcode in a fast burst
  // then sends Enter. Watching the whole page means staff can just scan — no
  // tapping into the search box first. The 120ms gap is what separates a
  // scanner's burst from human typing, so normal searching still works.
  const scanStateRef = useRef({ buf: "", last: 0 });
  const blockRef = useRef(false);
  blockRef.current = open || cameraOpen || !!printing;
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
        handleScan(code);
        return;
      }
      if (e.key.length === 1) s.buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, markdowns, today]);

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

  // Print one sticker per screen — the browser's own print dialog handles the
  // label printer, same as the price labels sheet.
  function printLabel(m: Markdown) {
    setPrinting(m);
    setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 60);
  }

  return (
    <div>
      <PageHeader
        title="Promotions"
        subtitle="Scan a product to discount it — the barcode stops working on the end date"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Running now" value={stats.active} icon={<TicketPercent size={18} />} accent="emerald" />
        <StatCard label="Starts later" value={stats.scheduled} icon={<CalendarClock size={18} />} accent="brand" />
        <StatCard label="Last day today" value={stats.endingToday} icon={<Tag size={18} />} accent="amber" />
        <StatCard label="Finished" value={stats.expired} icon={<CircleSlash size={18} />} accent="violet" />
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={18} />
            <input
              className="input h-12 pl-10 pr-12 text-base"
              placeholder="Scan a barcode · or search product, item ID, supplier, category, label code…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setScanned(null);
              }}
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

          {/* Scanned an item with nothing running on it — offer the discount
              right here rather than making them find it again in a dropdown. */}
          {scanned && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-900">{scanned.name}</p>
                <p className="text-xs text-slate-500">
                  {usd(scanned.price)} · no discount running — scan registered, set the price cut
                </p>
              </div>
              {mayDiscount ? (
                <button
                  className="btn-primary !py-2 text-xs"
                  onClick={() => {
                    setPreset(scanned.id);
                    setOpen(true);
                  }}
                >
                  <Plus size={14} /> Discount this
                </button>
              ) : (
                <span className="text-xs font-semibold text-slate-500">Ask a manager to discount it</span>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <Spinner label="Loading promotions…" />
        ) : error ? (
          <ErrorBox message={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? "No matching promotion" : "No promotions yet"}
            hint={
              q
                ? "Scan the item to discount it, or search by name, item ID, supplier, category or label code."
                : "Scan a product above — pick 30, 50 or 70% off and the dates, and the system mints a barcode for it."
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((m) => {
              const status = markdownStatus(m, today);
              const left = daysLeft(m, today);
              return (
                <div
                  key={m.id}
                  onClick={() => setPreviewCode(m.code)}
                  className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border p-3 transition sm:p-4 ${
                    preview?.code === m.code
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
                        : status === "Scheduled"
                          ? "Not started"
                          : status === "Expired"
                            ? "Barcode dead"
                            : "Pulled early"}
                    </p>
                  </div>

                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    {/* No reprinting a dead label — that sticker can't scan. */}
                    {(status === "Active" || status === "Scheduled") && (
                      <button className="btn-ghost !py-2 flex-1 text-xs sm:flex-none" onClick={() => printLabel(m)}>
                        <Printer size={14} /> Label
                      </button>
                    )}
                    {mayDiscount && (status === "Active" || status === "Scheduled") && (
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

      {/* The sticker itself. Seeing it beats printing to find out what it says —
          and after a scan narrows the list to one, it's already up. */}
      {preview && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-ink-900">Label</h3>
              <p className="text-xs text-slate-400">
                {preview.name} · prints at 4.7 × 2.5 cm — shown at double size
              </p>
            </div>
            {(markdownStatus(preview, today) === "Active" || markdownStatus(preview, today) === "Scheduled") && (
              <button className="btn-primary !py-2 text-xs" onClick={() => printLabel(preview)}>
                <Printer size={14} /> Print this label
              </button>
            )}
          </div>

          <div className="mt-4 flex justify-center rounded-xl bg-slate-50 p-6">
            <div className="shadow-soft">
              <PromoLabel m={preview} zoom={2} />
            </div>
          </div>

          {markdownStatus(preview, today) === "Expired" ? (
            <p className="mt-3 text-center text-xs text-slate-400">
              This label has expired — the barcode no longer scans, so there's nothing to print.
            </p>
          ) : markdownStatus(preview, today) === "Cancelled" ? (
            <p className="mt-3 text-center text-xs text-slate-400">
              This label was stopped early — the barcode no longer scans.
            </p>
          ) : (
            <p className="mt-3 text-center text-xs text-slate-400">
              Stick it on the reduced items only — the rest keep selling at {usd(preview.originalPrice)}.
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

      {open && (
        <NewMarkdownModal
          products={products || []}
          today={today}
          initialProductId={preset}
          onClose={() => {
            setOpen(false);
            setPreset("");
          }}
          onCreated={(m) => {
            setOpen(false);
            setPreset("");
            setScanned(null);
            reload();
            setToast(`${m.code} created — ${m.percent}% off ${m.name}. Print the label and stick it on.`);
          }}
        />
      )}

      {/* Print surface — hidden on screen, the only thing on paper. */}
      {printing && (
        <div className="promo-print-sheet">
          <PromoLabel m={printing} />
        </div>
      )}
      <style jsx global>{`
        .promo-print-sheet {
          position: fixed;
          left: -10000px;
          top: 0;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          .promo-print-sheet {
            position: absolute;
            left: 0;
            top: 0;
            visibility: visible;
          }
          .promo-print-sheet * {
            visibility: visible;
          }
          @page {
            margin: 4mm;
          }
        }
      `}</style>

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

function NewMarkdownModal({
  products,
  today,
  initialProductId = "",
  onClose,
  onCreated,
}: {
  products: Product[];
  today: string;
  initialProductId?: string;
  onClose: () => void;
  onCreated: (m: Markdown) => void;
}) {
  const [productId, setProductId] = useState(initialProductId);
  const [percent, setPercent] = useState(30);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // Pick the product by scanning it — the item is in your hand when you decide
  // to mark it down, so reaching for its barcode beats hunting for the name in
  // a list of thousands.
  const productsRef = useRef(products);
  productsRef.current = products;
  function resolveScan(code: string) {
    const c = code.trim();
    if (!c) return;
    const lc = c.toLowerCase();
    const hit = productsRef.current.find((p) => p.barcode === c || p.sku.toLowerCase() === lc);
    setCameraOpen(false);
    if (!hit) {
      setScanNote(`No product matches ${c}.`);
      return;
    }
    setProductId(hit.id);
    setScanNote(null);
    setErr(null);
  }

  // The Sunmi's wedge scanner while this dialog is up. The page's own listener
  // stands down whenever the dialog is open, so only one of them ever fires.
  const scanRef = useRef({ buf: "", last: 0 });
  const camRef = useRef(false);
  camRef.current = cameraOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (camRef.current) return;
      const now = Date.now();
      const s = scanRef.current;
      if (now - s.last > 120) s.buf = ""; // slow, human typing never builds up
      s.last = now;
      if (e.key === "Enter") {
        const code = s.buf.trim();
        s.buf = "";
        if (code.length < 3) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        resolveScan(code);
        return;
      }
      if (e.key.length === 1) s.buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: p.name,
        hint: `${p.sku} · ${usd(p.price)}${p.barcode ? ` · ${p.barcode}` : ""}`,
      })),
    [products],
  );

  const product = products.find((p) => p.id === productId) || null;
  const newPrice = product ? markdownPrice(product.price, percent) : 0;
  const saving = product ? product.price - newPrice : 0;

  async function submit() {
    if (!product) {
      setErr("Pick the product first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Markdown>("/api/markdowns", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, percent, startDate, endDate }),
      });
      onCreated(m);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Deliberately OUTSIDE the Modal: the dialog's fade-up animation leaves a
          transform on the panel, which would make it the containing block for
          this fullscreen (position: fixed) scanner and trap it in the box. */}
      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => resolveScan(code)}
        hint="Point the camera at the item's barcode to pick it."
      />
      <Modal
        open
        onClose={onClose}
        title="New discount"
        size="xl"
        footer={
          <>
            <button className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={busy || !product}>
              {busy ? "Creating…" : "Create label"}
            </button>
          </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label flex items-center gap-1.5">
            <ScanLine size={13} /> Product — scan it, or search
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchSelect
                value={productId}
                options={options}
                onChange={(v) => {
                  setProductId(v);
                  setScanNote(null);
                }}
                placeholder="Scan the barcode · or search by name, item ID…"
              />
            </div>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              title="Scan with the camera"
              aria-label="Scan the product barcode with the camera"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              <Camera size={18} />
            </button>
          </div>
          {scanNote && <p className="mt-1.5 text-xs font-semibold text-amber-600">{scanNote}</p>}
        </div>

        <div>
          <label className="label">Discount</label>
          <div className="grid grid-cols-3 gap-2">
            {MARKDOWN_PERCENTS.map((p) => (
              <button
                key={p}
                onClick={() => setPercent(p)}
                className={`rounded-xl py-3 text-base font-bold transition active:scale-[0.98] ${
                  percent === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">First selling day</label>
            <DatePicker
              value={startDate}
              onChange={(v) => {
                setStartDate(v);
                if (endDate < v) setEndDate(v); // keep the range sane as they pick
              }}
              min={today}
            />
          </div>
          <div>
            <label className="label">Last selling day</label>
            <DatePicker value={endDate} onChange={setEndDate} min={startDate > today ? startDate : today} />
            <p className="mt-1 text-[11px] text-slate-400">The barcode stops scanning the next morning.</p>
          </div>
        </div>

        {product && (
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-900">{product.name}</p>
                <p className="text-xs text-slate-400">
                  Customer saves {usd(saving)} · was {usd(product.price)}
                </p>
              </div>
              <div className="text-right">
                <span className="block text-2xl font-extrabold text-amber-700">{usd(newPrice)}</span>
                <span className="block text-[11px] font-semibold text-slate-400">{percent}% off</span>
              </div>
            </div>
            <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
              A new barcode is generated when you create this. The item's normal barcode keeps selling at full price.
            </p>
          </div>
        )}

        {err && <ErrorBox message={err} />}
      </div>
      </Modal>
    </>
  );
}
