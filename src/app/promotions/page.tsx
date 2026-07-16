"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Tag, Plus, Printer, Search, Ban, TicketPercent, CalendarClock, CircleSlash } from "lucide-react";
import JsBarcode from "jsbarcode";
import { useFetch, api, useRole } from "@/lib/client";
import type { Product, Markdown } from "@/lib/types";
import { PageHeader, Card, StatCard, Spinner, ErrorBox, EmptyState, Badge, Modal } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { DatePicker } from "@/components/DatePicker";
import { confirmDialog } from "@/components/confirm";
import { usd } from "@/lib/format";
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

// The printed sticker. It goes ON the reduced item, so it has to carry the new
// barcode, what the customer pays, and the date it dies — 4.7 × 2.5cm, matching
// the price-label stock already in the printer.
const DESIGN_W = 470;
const DESIGN_H = 250;
const LABEL_SCALE = (47 * 96) / 25.4 / DESIGN_W;
const LABEL_FONT = `'Plus Jakarta Sans Variable','Segoe UI',sans-serif`;

function PromoLabel({ m }: { m: Markdown }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, m.code, {
        format: "CODE128",
        width: 2,
        height: 34,
        displayValue: true,
        font: LABEL_FONT,
        fontSize: 13,
        textAlign: "left",
        textMargin: 1,
        margin: 0,
      });
    } catch {
      /* unencodable — leave the barcode area blank rather than crash the sheet */
    }
  }, [m.code]);

  return (
    <div
      className="promo-label"
      style={{
        width: DESIGN_W * LABEL_SCALE,
        height: DESIGN_H * LABEL_SCALE,
        overflow: "hidden",
        breakInside: "avoid",
      }}
    >
      <div
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${LABEL_SCALE})`,
          transformOrigin: "top left",
          fontFamily: LABEL_FONT,
          border: "2px solid #e11d48",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          background: "#fff",
        }}
      >
        <div style={{ background: "#e11d48", color: "#fff", padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 0.5 }}>{m.percent}% OFF</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>ENDS {shortDay(m.endDate).toUpperCase()}</span>
        </div>
        <div style={{ padding: "6px 12px 0", flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", lineHeight: 1.15, height: 46, overflow: "hidden" }}>
            {m.name}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
            <span style={{ fontSize: 40, fontWeight: 800, color: "#e11d48" }}>${m.price.toFixed(2)}</span>
            <span style={{ fontSize: 22, color: "#94a3b8", textDecoration: "line-through" }}>
              ${m.originalPrice.toFixed(2)}
            </span>
          </div>
        </div>
        <div style={{ padding: "0 12px 8px" }}>
          <svg ref={svgRef} />
        </div>
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

  // Today is resolved in the store's timezone, not the tablet's — a Sunmi with a
  // wrong clock shouldn't change which labels look live.
  const today = storeToday();

  const rows = useMemo(() => {
    const list = markdowns || [];
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? list.filter(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            m.code.includes(needle) ||
            m.sku.toLowerCase().includes(needle) ||
            (m.category || "").toLowerCase().includes(needle),
        )
      : list;
    // Live labels first — those are the ones staff act on.
    const rank: Record<MarkdownStatus, number> = { Active: 0, Scheduled: 1, Expired: 2, Cancelled: 3 };
    return [...matched].sort((a, b) => {
      const d = rank[markdownStatus(a, today)] - rank[markdownStatus(b, today)];
      return d !== 0 ? d : +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [markdowns, q, today]);

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
        subtitle="Discount a product, print its label — the barcode stops working on the end date"
        actions={
          mayDiscount ? (
            <button className="btn-primary !py-2 text-sm" onClick={() => setOpen(true)}>
              <Plus size={16} /> New discount
            </button>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Running now" value={stats.active} icon={<TicketPercent size={18} />} accent="emerald" />
        <StatCard label="Starts later" value={stats.scheduled} icon={<CalendarClock size={18} />} accent="brand" />
        <StatCard label="Last day today" value={stats.endingToday} icon={<Tag size={18} />} accent="amber" />
        <StatCard label="Finished" value={stats.expired} icon={<CircleSlash size={18} />} accent="violet" />
      </div>

      <Card>
        <div className="mb-4 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className="input pl-10"
            placeholder="Search product, label code or category…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
                ? "Try the product name or the label code."
                : "Register a product for 30, 50 or 70% off and the system mints a barcode for it."
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
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 sm:p-4"
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

      {open && (
        <NewMarkdownModal
          products={products || []}
          today={today}
          onClose={() => setOpen(false)}
          onCreated={(m) => {
            setOpen(false);
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
  onClose,
  onCreated,
}: {
  products: Product[];
  today: string;
  onClose: () => void;
  onCreated: (m: Markdown) => void;
}) {
  const [productId, setProductId] = useState("");
  const [percent, setPercent] = useState(30);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    <Modal
      open
      onClose={onClose}
      title="New discount"
      size="lg"
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
          <label className="label">Product</label>
          <SearchSelect
            value={productId}
            options={options}
            onChange={setProductId}
            placeholder="Search by name, item ID or barcode…"
          />
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
  );
}
