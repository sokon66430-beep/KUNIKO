"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  X,
  QrCode,
  Loader2,
  RefreshCw,
  Upload,
  FileSpreadsheet,
  BarChart3,
} from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Product, Customer, Sale, PaymentMethod } from "@/lib/types";
import { PageHeader, Spinner, ErrorBox, Badge } from "@/components/ui";
import { usd, riel, num } from "@/lib/format";
import { SearchSelect } from "@/components/SearchSelect";

type CartLine = { product: Product; qty: number; seq: number };

type GeneratedKhqr = {
  qr: string;
  md5: string;
  qrImage: string;
  amount: number;
  currency: "USD" | "KHR";
  expiresAt: number;
  mode: "live" | "sim";
  accountId: string;
  merchantName: string;
};

const PAYMENTS: PaymentMethod[] = ["Cash", "KHQR", "ABA", "Wing", "Card"];
const VAT_RATE = 0.1;

export default function PosPage() {
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/products");
  const { data: customers, reload: reloadCustomers } = useFetch<Customer[]>("/api/customers");

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const cartSeq = useRef(0);
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [payment, setPayment] = useState<PaymentMethod>("Cash");
  const [submitting, setSubmitting] = useState(false);
  const [khqrOpen, setKhqrOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  async function importSales(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/sales/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setToast(`Imported ${data.matched} sale lines (${data.salesCreated} days)${data.skipped ? ` · ${data.skipped} skipped` : ""}`);
      reload();
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  const categories = useMemo(() => {
    const set = new Set((products || []).map((p) => p.category));
    return ["All", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    let list = products || [];
    if (category !== "All") list = list.filter((p) => p.category === category);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.includes(q)
      );
    }
    return list;
  }, [products, category, query]);

  // Newest-added line on top so the cashier always sees what they just scanned.
  const lines = Object.values(cart).sort((a, b) => b.seq - a.seq);
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const taxed = subtotal - discountNum;
  const tax = taxed * VAT_RATE;
  const total = taxed + tax;

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev[product.id];
      const qty = (existing?.qty || 0) + 1;
      if (qty > product.stock) {
        setToast(`Only ${product.stock} ${product.unit} of ${product.name} in stock`);
        return prev;
      }
      cartSeq.current += 1; // bump so the just-scanned line floats to the top
      return { ...prev, [product.id]: { product, qty, seq: cartSeq.current } };
    });
  }

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const line = prev[id];
      if (!line) return prev;
      if (qty <= 0) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (qty > line.product.stock) {
        setToast(`Only ${line.product.stock} ${line.product.unit} in stock`);
        return prev;
      }
      return { ...prev, [id]: { ...line, qty } };
    });
  }

  function clearCart() {
    setCart({});
    setDiscount("");
    setCustomerId("");
    setPayment("Cash");
  }

  async function commitSale(paymentRef?: string) {
    const sale = await api<Sale>("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        items: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        customerId: customerId || null,
        discount: discountNum,
        paymentMethod: payment,
        paymentRef,
      }),
    });
    setReceipt(sale);
    setKhqrOpen(false);
    clearCart();
    reload();
    reloadCustomers();
    return sale;
  }

  async function handleCharge() {
    if (lines.length === 0) return;
    // Digital payment: show the KHQR, wait for the customer to pay, then commit.
    if (payment === "KHQR") {
      setKhqrOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      await commitSale();
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Point of Sale"
        subtitle="Ring up a sale — stock and loyalty update automatically"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost !py-2 text-sm" onClick={() => setReportOpen(true)}>
              <BarChart3 size={16} /> Sales Report
            </button>
            <a className="btn-ghost !py-2 text-sm" href="/api/reports/sales/export">
              <FileSpreadsheet size={16} /> Export
            </a>
            <button className="btn-ghost !py-2 text-sm" disabled={importing} onClick={() => importRef.current?.click()}>
              <Upload size={16} /> {importing ? "Importing…" : "Import"}
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSales(f);
              }}
            />
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      {reportOpen && <SalesReportModal onClose={() => setReportOpen(false)} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Product picker */}
        <div>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                className="input pl-10"
                placeholder="Search product, Item ID or barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  category === c ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {loading ? (
            <Spinner label="Loading products…" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => {
                const out = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    disabled={out}
                    onClick={() => addToCart(p)}
                    className="group card flex flex-col p-3 text-left transition hover:-translate-y-0.5 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {p.sku}
                      </span>
                      {p.stock <= p.reorderLevel && !out && (
                        <span className="text-[10px] font-bold text-amber-500">low</span>
                      )}
                      {out && <span className="text-[10px] font-bold text-rose-500">out</span>}
                    </div>
                    <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-ink-800">{p.name}</p>
                    <div className="mt-2 flex items-end justify-between">
                      <span className="text-base font-bold text-brand-600">{usd(p.price)}</span>
                      <span className="text-[11px] text-slate-400">{p.stock} {p.unit}</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-full py-12 text-center text-sm text-slate-400">No products match your search.</p>
              )}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="card flex max-h-[calc(100vh-7rem)] flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-brand-600" />
                <h3 className="font-bold text-ink-900">Current Sale</h3>
              </div>
              {lines.length > 0 && (
                <button onClick={clearCart} className="text-xs font-semibold text-slate-400 hover:text-rose-500">
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {lines.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  Tap products to add them to the sale.
                </div>
              ) : (
                <div className="space-y-3">
                  {lines.map((l) => (
                    <div key={l.product.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-800">{l.product.name}</p>
                        <p className="text-xs text-slate-400">{usd(l.product.price)} each</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setQty(l.product.id, l.qty - 1)}
                          className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-7 text-center text-sm font-bold">{l.qty}</span>
                        <button
                          onClick={() => setQty(l.product.id, l.qty + 1)}
                          className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-bold text-ink-900">
                        {usd(l.product.price * l.qty)}
                      </span>
                      <button
                        onClick={() => setQty(l.product.id, 0)}
                        className="text-slate-300 hover:text-rose-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer / checkout */}
            <div className="space-y-3 border-t border-slate-100 px-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Customer</label>
                  <select className="input py-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Walk-in</option>
                    {(customers || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Discount $</label>
                  <input
                    className="input py-2"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label">Payment</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPayment(p)}
                      className={`flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold transition ${
                        payment === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {p === "KHQR" && <QrCode size={13} />}
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                <Row label="Subtotal" value={usd(subtotal)} />
                {discountNum > 0 && <Row label="Discount" value={`- ${usd(discountNum)}`} tone="rose" />}
                <Row label={`VAT (${Math.round(VAT_RATE * 100)}%)`} value={usd(tax)} />
                <div className="my-1 border-t border-dashed border-slate-200" />
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink-900">Total</span>
                  <span className="text-right">
                    <span className="block text-lg font-bold text-brand-600">{usd(total)}</span>
                    <span className="block text-[11px] text-slate-400">{riel(total)}</span>
                  </span>
                </div>
              </div>

              <button
                onClick={handleCharge}
                disabled={lines.length === 0 || submitting}
                className="btn-primary w-full py-3 text-base"
              >
                {payment === "KHQR" && <QrCode size={18} />}
                {submitting
                  ? "Processing…"
                  : payment === "KHQR"
                  ? `Pay by KHQR · ${usd(total)}`
                  : `Charge ${usd(total)}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KHQR payment modal */}
      {khqrOpen && (
        <KhqrModal
          amount={total}
          billNumber={`MK-${Date.now().toString().slice(-6)}`}
          onCancel={() => setKhqrOpen(false)}
          onConfirmed={async (md5) => {
            try {
              await commitSale(md5);
            } catch (e: any) {
              setToast(e.message);
              setKhqrOpen(false);
            }
          }}
        />
      )}

      {/* Receipt modal */}
      {receipt && <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-soft">
          {toast}
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "rose" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={tone === "rose" ? "font-semibold text-rose-600" : "font-semibold text-ink-800"}>{value}</span>
    </div>
  );
}

function ReceiptModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-soft">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={30} />
          </div>
          <h3 className="text-lg font-bold text-ink-900">Payment Complete</h3>
          <p className="text-sm text-slate-500">{sale.invoiceNo}</p>
        </div>

        <div className="rounded-xl border border-dashed border-slate-200 p-4">
          <div className="mb-2 text-center">
            <p className="font-bold text-ink-900">Monakom Pro Store</p>
            <p className="text-[11px] text-slate-400">St. 271, Phnom Penh · 023 900 100</p>
          </div>
          <div className="space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
            {sale.items.map((it) => (
              <div key={it.productId} className="flex justify-between gap-2">
                <span className="truncate text-slate-600">
                  {it.qty}× {it.name}
                </span>
                <span className="font-semibold text-ink-800">{usd(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
            <Row label="Subtotal" value={usd(sale.subtotal)} />
            {sale.discount > 0 && <Row label="Discount" value={`- ${usd(sale.discount)}`} tone="rose" />}
            <Row label="VAT" value={usd(sale.tax)} />
            <div className="flex justify-between pt-1 text-base font-bold text-ink-900">
              <span>Total</span>
              <span>{usd(sale.total)}</span>
            </div>
            <p className="text-right text-[11px] text-slate-400">{riel(sale.total)}</p>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-dashed border-slate-200 pt-2 text-xs text-slate-500">
            <span>Paid by {sale.paymentMethod}</span>
            <Badge tone="emerald">{sale.customerName || "Walk-in"}</Badge>
          </div>
        </div>

        <button onClick={onClose} className="btn-primary mt-4 w-full">
          New Sale
        </button>
      </div>
    </div>
  );
}

function fmtCountdown(s: number) {
  const m = Math.floor(s / 60);
  const ss = (s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

function KhqrModal({
  amount,
  billNumber,
  onCancel,
  onConfirmed,
}: {
  amount: number;
  billNumber: string;
  onCancel: () => void;
  onConfirmed: (md5: string) => void;
}) {
  const [data, setData] = useState<GeneratedKhqr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "paid" | "expired" | "error">("loading");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [simBusy, setSimBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const confirmedRef = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  // Generate (or regenerate) the QR.
  useEffect(() => {
    let alive = true;
    confirmedRef.current = false;
    setData(null);
    setError(null);
    setStatus("loading");
    api<GeneratedKhqr>("/api/payments/khqr", {
      method: "POST",
      body: JSON.stringify({ amount, currency: "USD", billNumber }),
    })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setStatus("waiting");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [amount, billNumber, nonce]);

  // Countdown + payment polling.
  useEffect(() => {
    if (!data || status !== "waiting") return;
    let alive = true;

    const tick = () => {
      const left = Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setStatus("expired");
    };
    tick();
    const countdown = setInterval(tick, 1000);

    const poll = setInterval(async () => {
      try {
        const s = await api<{ paid: boolean; authError?: boolean; message?: string }>(
          `/api/payments/khqr/status?md5=${data.md5}`
        );
        if (!alive) return;
        if (s.authError) {
          setError(s.message || "Bakong token invalid or expired");
          setStatus("error");
        } else if (s.paid && !confirmedRef.current) {
          confirmedRef.current = true;
          setStatus("paid");
          setTimeout(() => onConfirmedRef.current(data.md5), 600);
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2500);

    return () => {
      alive = false;
      clearInterval(countdown);
      clearInterval(poll);
    };
  }, [data, status]);

  async function simulate() {
    if (!data) return;
    setSimBusy(true);
    try {
      await api("/api/payments/khqr/simulate", { method: "POST", body: JSON.stringify({ md5: data.md5 }) });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSimBusy(false);
    }
  }

  function manualConfirm() {
    if (!data || confirmedRef.current) return;
    confirmedRef.current = true;
    setStatus("paid");
    onConfirmedRef.current(data.md5);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-soft">
        {/* KHQR brand band */}
        <div className="flex items-center justify-between bg-[#e21a1a] px-5 py-3 text-white">
          <span className="text-lg font-black tracking-tight">KHQR</span>
          <span className="text-xs font-medium opacity-90">Scan with any Cambodian banking app</span>
        </div>

        <div className="p-5">
          {data?.mode === "sim" && status !== "paid" && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <b>Simulation mode</b> — no live Bakong account set. The QR is a demo; use “Simulate payment” to test.
            </div>
          )}

          {status === "loading" && (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Loader2 className="animate-spin" size={26} />
              <span className="text-sm">Generating KHQR…</span>
            </div>
          )}

          {status === "error" && (
            <div className="py-6 text-center">
              <p className="text-sm font-semibold text-rose-600">{error || "Could not generate KHQR"}</p>
              <button className="btn-ghost mt-4" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw size={16} /> Try again
              </button>
            </div>
          )}

          {status === "paid" && (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={36} />
              </div>
              <p className="text-lg font-bold text-ink-900">Payment received</p>
              <p className="text-sm text-slate-500">Finalizing sale…</p>
            </div>
          )}

          {(status === "waiting" || status === "expired") && data && (
            <>
              <div className="text-center">
                <p className="text-sm text-slate-500">{data.merchantName}</p>
                <p className="mt-0.5 text-2xl font-bold text-ink-900">{usd(amount)}</p>
                <p className="text-xs text-slate-400">{riel(amount)}</p>
              </div>

              <div className="relative mx-auto mt-4 w-fit rounded-xl border border-slate-200 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.qrImage} alt="KHQR payment code" className="h-56 w-56" />
                {status === "expired" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/85">
                    <p className="mb-2 text-sm font-bold text-slate-600">QR expired</p>
                    <button className="btn-primary py-2" onClick={() => setNonce((n) => n + 1)}>
                      <RefreshCw size={16} /> New code
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-2 text-center font-mono text-xs text-slate-400">{data.accountId}</p>

              {status === "waiting" && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="animate-spin text-brand-600" size={16} />
                  Waiting for payment · expires in{" "}
                  <span className="font-semibold text-ink-800">{fmtCountdown(secondsLeft)}</span>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {data.mode === "sim" && status === "waiting" && (
                  <button className="btn-primary w-full" disabled={simBusy} onClick={simulate}>
                    {simBusy ? "Confirming…" : "Simulate customer payment"}
                  </button>
                )}
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={onCancel}>
                    Cancel
                  </button>
                  <button className="btn-ghost flex-1" onClick={manualConfirm}>
                    Mark as received
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Sales report — units sold, revenue and profit by item and by category.
// -------------------------------------------------------------------------
type ItemRow = { sku: string; name: string; category: string; qty: number; revenue: number; cost: number; profit: number };
type CatRow = { category: string; qty: number; revenue: number; cost: number; profit: number };
type SalesReportData = {
  byItem: ItemRow[];
  byCategory: CatRow[];
  totals: { qty: number; revenue: number; cost: number; profit: number; sales: number };
};

function SalesReportModal({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<number | null>(30);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : null;
  const url = from ? `/api/sales-report?from=${from}` : "/api/sales-report";
  const { data, loading } = useFetch<SalesReportData>(url);
  const ranges: { label: string; value: number | null }[] = [
    { label: "7 days", value: 7 },
    { label: "30 days", value: 30 },
    { label: "90 days", value: 90 },
    { label: "All time", value: null },
  ];

  // Only categories that actually sold — pick one to focus the item list.
  const categoryOptions = useMemo(
    () => [
      { value: "All", label: "All categories" },
      ...(data ? data.byCategory.map((c) => ({ value: c.category, label: c.category, hint: `${c.qty}` })) : []),
    ],
    [data],
  );
  const ql = q.trim().toLowerCase();
  const items = useMemo(() => {
    if (!data) return [];
    return data.byItem.filter(
      (it) =>
        (cat === "All" || it.category === cat) &&
        (!ql || it.name.toLowerCase().includes(ql) || it.sku.toLowerCase().includes(ql)),
    );
  }, [data, cat, ql]);
  const shown = useMemo(
    () => items.reduce((a, it) => ({ qty: a.qty + it.qty, revenue: a.revenue + it.revenue, profit: a.profit + it.profit }), { qty: 0, revenue: 0, profit: 0 }),
    [items],
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-brand-600" />
            <h3 className="text-base font-bold text-ink-900">Sales Report — by item</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {ranges.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setDays(r.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    days === r.value ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading || !data ? (
            <div className="grid h-40 place-items-center text-sm text-slate-400">Loading…</div>
          ) : data.totals.sales === 0 ? (
            <div className="grid h-40 place-items-center text-sm text-slate-400">
              No sales in this period. Ring up a sale or use Import to load history.
            </div>
          ) : (
            <>
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Sales are imported daily from your POS — figures are current up to your last import (usually yesterday).
              </p>

              {/* Filters: a searchable category picker + item search (no raw dropdown) */}
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <SearchSelect
                  value={cat}
                  options={categoryOptions}
                  onChange={setCat}
                  placeholder="All categories"
                  className="sm:w-[240px]"
                />
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    className="input pl-9"
                    placeholder="Search an item by name or code…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>

              {/* Totals for the current filter */}
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Items", value: num(items.length) },
                  { label: "Units sold", value: num(shown.qty) },
                  { label: "Revenue", value: usd(shown.revenue) },
                  { label: "Profit", value: usd(shown.profit) },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
                    <p className="mt-1 text-lg font-bold text-ink-900">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* By item */}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Sold</th>
                      <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                      <th className="px-3 py-2 text-right font-semibold">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.sku} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium text-ink-800">{it.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {it.sku} · {it.category}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-ink-800">{num(it.qty)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{usd(it.revenue)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{usd(it.profit)}</td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">
                          No items match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Showing {items.length} item{items.length === 1 ? "" : "s"} — use Export for the full spreadsheet.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
