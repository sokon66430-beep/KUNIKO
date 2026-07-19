"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { barcodeIncludes } from "@/lib/barcodes";
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
  ScanLine,
  ChevronLeft,
  Sparkles,
  Star,
  Wallet,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { useFetch, api, useAccess } from "@/lib/client";
import type { Product, Customer, Sale, PaymentMethod, Markdown } from "@/lib/types";
import { isMarkdownCode, isSellable, markdownStatus, storeToday } from "@/lib/markdowns";
import { PageHeader, Spinner, ErrorBox, Badge } from "@/components/ui";
import { usd, riel, num, EXCHANGE_RATE, dateTime } from "@/lib/format";
import { SearchSelect } from "@/components/SearchSelect";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { CameraScanner } from "@/components/CameraScanner";
import { canSeeProfit } from "@/lib/access";
import { formatQueue } from "@/lib/queue";
import { ReceiptCard, type ReceiptBusiness } from "@/components/Receipt";
import { PosShiftModal } from "@/components/PosShiftModal";
import { isShownOnPos } from "@/lib/pos";
import type { PromotionApplication as PromoApplication } from "@/lib/promotions";
import { baseUnitName, defaultUnitOf, findByBarcode, type ResolvedUnit } from "@/lib/sellingUnits";

// A discounted line and a full-price line for the SAME product can sit in one
// sale (the customer grabbed one reduced loaf and one fresh), so the markdown
// is part of the line — and part of its cart key. So is the packaging: a can
// and a case of the same drink are two lines, priced differently.
//
// `qty` here counts the UNIT the line is sold in — 2 means two cases. The base
// quantity is only worked out when the sale is sent, which keeps the +/- buttons
// meaning what the cashier expects: one more case, not one more can.
type CartLine = { product: Product; qty: number; seq: number; markdown?: Markdown; unit: ResolvedUnit };

function lineKey(product: Product, markdown?: Markdown, unit?: ResolvedUnit): string {
  const u = unit && !unit.isBase ? `::${unit.id}` : "";
  return markdown ? `${product.id}::${markdown.code}${u}` : `${product.id}${u}`;
}
/** What one of whatever this line sells costs. */
function linePrice(l: CartLine): number {
  if (l.markdown) return l.markdown.price * l.unit.conversion;
  return l.unit.price;
}
/** How many base units this line takes off the shelf. */
function lineBaseQty(l: CartLine): number {
  return l.qty * l.unit.conversion;
}

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
  const { data: markdowns } = useFetch<Markdown[]>("/api/markdowns");
  // What actually sells — used to offer the obvious favourites rather than
  // making someone hunt for their own best sellers through the categories.
  const { data: salesReport } = useFetch<{ byItem: { productId: string; qty: number }[] }>("/api/sales-report");
  // Store profile + receipt styling for the printed receipt (Invoice Customization).
  const { data: business } = useFetch<ReceiptBusiness>("/api/business");

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const cartSeq = useRef(0);
  const [promos, setPromos] = useState<PromoApplication[]>([]);
  const promoSeq = useRef(0); // guards against out-of-order preview replies
  // Favourite stars tapped but not yet confirmed by the server, id → next value.
  const [favPending, setFavPending] = useState<Record<string, boolean>>({});
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [payment, setPayment] = useState<PaymentMethod>("Cash");
  // Pickup number: the cashier turns this on for orders the customer waits for
  // (coffee, noodles, warmed food). The server issues the number centrally.
  const [wantQueue, setWantQueue] = useState(false);
  // This till's identifier, saved per device so the queue record shows which POS
  // issued a number. Set once in the checkout box; persists in localStorage.
  const [terminal, setTerminal] = useState("POS 1");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("stookii_pos_terminal") : null;
    if (saved) setTerminal(saved);
  }, []);
  const saveTerminal = (v: string) => {
    setTerminal(v);
    if (typeof window !== "undefined") window.localStorage.setItem("stookii_pos_terminal", v);
  };
  const [submitting, setSubmitting] = useState(false);
  const [khqrOpen, setKhqrOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  // The cash shift, opened right here in the till: live drawer summary + close.
  const [shiftOpen, setShiftOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null); // drilled-into category at the till
  const [importing, setImporting] = useState(false);
  // Import is all-or-nothing: nothing lands until every row is fully readable
  // and none of its dates are already on record. This holds whatever the
  // server rejected the file for, so the banner can explain and (for
  // unmatched products) offer a fixable download.
  const [importIssue, setImportIssue] = useState<{
    message: string;
    skippedItems: { code?: string; barcode?: string; name?: string; rows?: number; units?: number }[];
    // `message` is the legacy single-field shape — kept so an in-flight deploy
    // (new page, old server) still shows the reason instead of a blank cell.
    problems: { row: number; product?: string; issue?: string; qty?: number; message?: string }[];
    totalProblems: number;
    duplicateDates: string[];
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // Live mirrors for the global barcode-scanner listener (which is attached once
  // and must always see the latest products / dialog state).
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products ?? [];
  const markdownsRef = useRef<Markdown[]>([]);
  markdownsRef.current = markdowns ?? [];
  const blockScanRef = useRef(false);
  blockScanRef.current = khqrOpen || cashOpen || !!receipt || reportOpen || invoicesOpen || cameraOpen || shiftOpen;

  async function importSales(file: File) {
    setImporting(true);
    setImportIssue(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/sales/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setImportIssue({
          message: data.error || "Import failed — nothing was imported.",
          skippedItems: data.skippedItems || [],
          problems: data.problems || [],
          totalProblems: data.totalProblems || 0,
          duplicateDates: data.duplicateDates || [],
        });
        return;
      }
      const dupes: number = data.skippedDuplicates || 0;
      const skippedDates: string[] = data.skippedDates || [];
      // A skipped tail: either individual duplicate transactions (invoice-level)
      // or whole dates (when the file has no invoice column to match on).
      const skipNote = dupes
        ? ` · skipped ${dupes} duplicate transaction${dupes === 1 ? "" : "s"} already on record`
        : skippedDates.length
          ? ` · skipped ${skippedDates.length} date${skippedDates.length === 1 ? "" : "s"} already on record (${skippedDates.join(", ")})`
          : "";
      // What the file did to STOCK, not just to the reports. Only lines that
      // sold after a product's last count come off (the count already saw the
      // rest), so say which — an import that silently moves stock, or silently
      // doesn't, is the kind of thing you only discover at the next count.
      const st = data.stock;
      const stockNote = !st
        ? ""
        : st.unitsReduced
          ? ` · stock −${st.unitsReduced} units sold after counting` +
            (st.neverCounted ? ` · ${st.neverCounted} line${st.neverCounted === 1 ? "" : "s"} left alone (never counted)` : "") +
            (st.sameDayNoTime ? ` · ${st.sameDayNoTime} same-day line${st.sameDayNoTime === 1 ? "" : "s"} with no time` : "")
          : st.beforeCount || st.neverCounted || st.sameDayNoTime
            ? ` · stock unchanged (${
                st.beforeCount ? `${st.beforeCount} already counted` : st.neverCounted ? "never counted" : "no times to place them"
              })`
            : "";
      if (data.matched === 0 && (dupes || skippedDates.length)) {
        setToast(`Nothing new to import${skipNote.replace(" · ", " — ")}`);
      } else {
        setToast(`Imported ${data.matched} sale lines (${data.salesCreated} days)${skipNote}${stockNote}`);
      }
      reload();
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  // Download the unmatched-product rows (things the import couldn't match) as an Excel file.
  async function downloadSkipped() {
    if (!importIssue) return;
    try {
      const res = await fetch("/api/sales/skipped-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: importIssue.skippedItems }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "skipped-items.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setToast("Could not build the skipped-items file.");
    }
  }

  // The till only shows matches while the cashier is actually searching.
  // Is anything modal on screen? A toast has to get out of a dialog's way — a
  // dialog's buttons live at the bottom, which is exactly where the toast sits.
  const modalOpen = khqrOpen || cashOpen || !!receipt || reportOpen || invoicesOpen || cameraOpen || shiftOpen;

  // Toasts clear themselves. Without this a message stayed until someone
  // clicked its X by hand — which is how a note about a star tapped minutes
  // earlier was still on screen, on top of the cash dialog's Confirm button.
  // A till can't have yesterday's message sitting over today's button.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const searching = query.trim().length > 0;

  // The catalogue as the SCREEN should show it: the server's copy with any
  // just-tapped favourite folded in. Everything below reads this, so a star
  // can't look on in one list and off in another.
  const catalog = useMemo(
    () => (products || []).map((p) => (p.id in favPending ? { ...p, favourite: favPending[p.id] } : p)),
    [products, favPending],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || barcodeIncludes(p, q),
    );
  }, [catalog, query]);

  // Sell-directly items: the ones flagged "Show on POS" in Master Data (falling
  // back to the default counter categories until the flag is set). Everything
  // else is sold by scanning and stays off the screen. Grouped by category.
  const directSaleGroups = useMemo(() => {
    const onPos = catalog.filter((p) => isShownOnPos(p));
    const byCat = new Map<string, Product[]>();
    for (const p of onPos) {
      const list = byCat.get(p.category) ?? [];
      list.push(p);
      byCat.set(p.category, list);
    }
    return [...byCat.entries()]
      .map(([category, items]) => ({ category, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [catalog]);
  const directSaleCount = directSaleGroups.reduce((s, g) => s + g.items.length, 0);

  // --- Favourites -----------------------------------------------------------
  // The handful of things that sell all day, pinned to the front of the till so
  // they're one tap instead of a category drill-down.
  //
  // `favPending` is an optimistic overlay: a cashier taps a star between
  // customers and shouldn't wait on a round-trip, and reloading here means
  // refetching the whole catalogue. Applied once, at the source, so every list
  // below (favourites, categories, search) shows the same state.
  const favourites = useMemo(() => catalog.filter((p) => p.favourite), [catalog]);

  // The best sellers that AREN'T favourites yet — the shortlist worth pinning,
  // taken from what the till has actually rung up rather than a guess.
  const favouriteSuggestions = useMemo(() => {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    return (salesReport?.byItem || [])
      .map((row) => byId.get(row.productId))
      .filter((p): p is Product => !!p && !p.favourite)
      .slice(0, 6);
  }, [salesReport, catalog]);

  async function toggleFavourite(p: Product) {
    const next = !p.favourite;
    setFavPending((s) => ({ ...s, [p.id]: next }));
    try {
      await api(`/api/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ favourite: next }) });
      // No toast: the star fills in and the tile moves to Favourites, which says
      // it better than a message would. A toast for something already visible is
      // just something else in the cashier's way.
      reload();
    } catch (e: any) {
      // The write failed, so drop the guess and let the server's answer stand.
      setFavPending((s) => {
        const rest = { ...s };
        delete rest[p.id];
        return rest;
      });
      setToast(e.message);
    }
  }
  // Two-step till: pick a category, then the item inside it. Favourites is a
  // pseudo-category pinned to the FRONT of the grid — tapping it drills into the
  // starred items exactly like a real category.
  const FAV = "__favourites__";
  const openGroup = openCat && openCat !== FAV ? directSaleGroups.find((g) => g.category === openCat) ?? null : null;

  // Newest-added line on top so the cashier always sees what they just scanned.
  const lines = Object.values(cart).sort((a, b) => b.seq - a.seq);

  // --- Promotions the basket qualifies for ---------------------------------
  // Asked of the server rather than worked out here: the engine needs every
  // promotion record and every product's real price, and a second copy of the
  // rules living in the till is a second copy that can drift from the one that
  // actually charges the customer.
  const basketKey = JSON.stringify(
    [...lines]
      .sort((a, b) => a.product.id.localeCompare(b.product.id))
      .map((l) => [l.product.id, l.qty, l.markdown?.code, l.unit.id]),
  );
  useEffect(() => {
    if (lines.length === 0) {
      setPromos([]);
      return;
    }
    // Scanning fires these faster than they return, so tag each request and
    // ignore any answer that isn't for the newest basket — otherwise a slow
    // reply for 2 bottles could overwrite the right answer for 3.
    const seq = ++promoSeq.current;
    api<{ applications: PromoApplication[] }>("/api/promotions/preview", {
      method: "POST",
      body: JSON.stringify({
        // Promotions count BASE units: a "buy 2 get 1 free" on cans has to see
        // a case as the 24 cans it is, not as one item.
        items: lines.map((l) => ({
          productId: l.product.id,
          qty: lineBaseQty(l),
          markdownCode: l.markdown?.code,
        })),
      }),
    })
      .then((r) => {
        if (seq === promoSeq.current) setPromos(r.applications || []);
      })
      .catch(() => {
        // Preview unavailable — show no deal rather than a stale one. The sale
        // still gets it: the server applies promotions whatever this says.
        if (seq === promoSeq.current) setPromos([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketKey]);
  const promoDiscount = promos.reduce((s, a) => s + a.discount, 0);
  // Selling prices are VAT-INCLUSIVE: the sticker price already contains VAT, so
  // the customer pays it as-is — VAT is the portion inside, never added on top.
  const gross = lines.reduce((s, l) => s + linePrice(l) * l.qty, 0);
  const manualDiscount = Math.min(Number(discount) || 0, gross);
  // Deals the engine says apply to what's in the basket right now. The server
  // works these out again for real when the sale lands — this is the preview
  // that lets the cashier tell the customer BEFORE taking the money, and it has
  // to be in the total or the change owed would be wrong.
  const discountNum = Math.min(manualDiscount + promoDiscount, gross);
  const total = gross - discountNum; // what the customer pays (VAT included)
  const subtotal = total / (1 + VAT_RATE); // net of the included VAT
  const tax = total - subtotal; // VAT already contained in the price

  // Overselling is allowed: items can be rung up past the on-hand count, which
  // simply lets stock go negative (-1, -2, …). No quantity cap here.
  // `unit` omitted = whatever the product's default packaging is (the base unit
  // unless someone set a pack as default), which is what tapping a tile means.
  function addToCart(product: Product, markdown?: Markdown, unit?: ResolvedUnit) {
    const u = unit || defaultUnitOf(product);
    const key = lineKey(product, markdown, u);
    setCart((prev) => {
      const existing = prev[key];
      const qty = (existing?.qty || 0) + 1;
      cartSeq.current += 1; // bump so the just-scanned line floats to the top
      return { ...prev, [key]: { product, qty, seq: cartSeq.current, markdown, unit: u } };
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
      return { ...prev, [id]: { ...line, qty } };
    });
  }

  function clearCart() {
    setCart({});
    setDiscount("");
    setCustomerId("");
    setPayment("Cash");
  }

  // Shared scan handler for BOTH scan paths (hardware keyboard-wedge scanner and
  // the on-screen camera scanner): find the product by barcode or SKU and ring
  // it straight into the cart. Returns whether a product was matched.
  function ringUpByCode(code: string): boolean {
    const q = code.trim();
    if (!q) return false;

    // A discount label first: its code lives in its own 92… range, so it can
    // never be confused with a shelf barcode. An out-of-date label is REFUSED
    // here rather than quietly ringing up at full price — the cashier needs to
    // know the sticker is dead before the customer is charged.
    if (isMarkdownCode(q)) {
      const m = markdownsRef.current.find((x) => x.code === q);
      if (!m) {
        setToast(`Discount label ${q} isn't in the system.`);
        return true;
      }
      const prod = productsRef.current.find((p) => p.id === m.productId);
      if (!prod) {
        setToast(`${m.name} is no longer stocked here.`);
        return true;
      }
      if (!isSellable(m)) {
        const status = markdownStatus(m);
        setToast(
          status === "Expired"
            ? `${m.percent}% label expired on ${m.endDate} — sell ${m.name} at full price.`
            : status === "Scheduled"
              ? `${m.percent}% label on ${m.name} doesn't start until ${m.startDate}.`
              : `${m.percent}% label on ${m.name} was stopped — sell at full price.`,
        );
        return true;
      }
      addToCart(prod, m);
      setToast(`Added ${prod.name} — ${m.percent}% off`);
      return true;
    }

    // A pack/case barcode resolves to the product AND the packaging it was on,
    // so scanning a case rings up a case — the cashier never picks the unit.
    const hit = findByBarcode(productsRef.current, q);
    if (!hit) return false;
    addToCart(hit.product, undefined, hit.unit);
    setToast(
      hit.unit.isBase
        ? `Added ${hit.product.name}`
        : `Added ${hit.product.name} — 1 ${hit.unit.name} (${hit.unit.conversion} ${baseUnitName(hit.product)})`,
    );
    return true;
  }

  // Real-POS barcode scanning: the Sunmi L3's built-in scanner (and any USB
  // "keyboard-wedge" scanner) types the barcode very fast and then sends Enter.
  // We watch keystrokes for the whole page — so the cashier can just scan, with
  // NO need to tap the search box first — buffer the fast burst, and ring the
  // item up on Enter. Slow (human) typing never accumulates into the buffer, so
  // manual search and checkout typing keep working normally.
  useEffect(() => {
    let buf = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (blockScanRef.current) return; // a dialog (KHQR / receipt / report / camera) is open
      const now = Date.now();
      if (now - last > 120) buf = ""; // gap too long → human, not a scan; restart
      last = now;
      if (e.key === "Enter") {
        const code = buf.trim();
        buf = "";
        if (code.length < 3) return; // too short to be a real barcode/scan
        // Ring it up and swallow the Enter so a focused field (e.g. search)
        // doesn't also act on it. Unknown codes fall through to normal handling.
        if (ringUpByCode(code)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setQuery("");
        }
        return;
      }
      if (e.key.length === 1) buf += e.key; // accumulate printable chars
    };
    window.addEventListener("keydown", onKey, true); // capture: run before field handlers
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commitSale(opts?: { paymentRef?: string; tendered?: number }) {
    const sale = await api<Sale>("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        // The markdown CODE goes up, not its price — the server re-reads the
        // label and re-checks it's still live before discounting anything. Same
        // for packaging: the unit ID goes up, and the server re-reads its
        // conversion and price rather than trusting the base qty we send.
        items: lines.map((l) => ({
          productId: l.product.id,
          qty: lineBaseQty(l),
          markdownCode: l.markdown?.code,
          unitId: l.unit.isBase ? undefined : l.unit.id,
          unitQty: l.unit.isBase ? undefined : l.qty,
        })),
        customerId: customerId || null,
        // ONLY the cashier's typed discount. The promotion part of `discountNum`
        // is the server's own to work out — sending it back would have it
        // counted twice.
        discount: manualDiscount,
        paymentMethod: payment,
        paymentRef: opts?.paymentRef,
        tendered: opts?.tendered,
        // Ask the server for a pickup number only when the cashier turned it on.
        queue: wantQueue,
        posTerminalId: terminal,
      }),
    });
    setReceipt(sale);
    setKhqrOpen(false);
    setCashOpen(false);
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
    // Cash: count what the customer handed over first, so the till can show the
    // change owed instead of the cashier doing the maths in their head.
    if (payment === "Cash") {
      setCashOpen(true);
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

  const cartCount = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className={lines.length > 0 ? "pb-24 lg:pb-0" : undefined}>
      <PageHeader
        title="Point of Sale"
        subtitle="Ring up a sale — stock and loyalty update automatically"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-ghost !py-2 text-sm"
              onClick={() => setShiftOpen(true)}
              title="Shift summary, cash drawer & close shift — without leaving the till"
            >
              <Wallet size={16} /> Cash Drawer
            </button>
            <button className="btn-ghost !py-2 text-sm" onClick={() => setInvoicesOpen(true)} title="Recent invoices — cancel a wrong sale">
              <ReceiptText size={16} /> Invoices
            </button>
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

      {importIssue && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <p className="flex-1 text-sm font-medium text-amber-800">{importIssue.message}</p>
            <div className="flex items-center gap-2">
              {importIssue.skippedItems.length > 0 && (
                <button className="btn-primary !py-2 text-sm" onClick={downloadSkipped}>
                  <FileSpreadsheet size={16} /> Download unmatched items (Excel)
                </button>
              )}
              <button
                className="grid h-8 w-8 place-items-center rounded-lg text-amber-500 hover:bg-amber-100"
                onClick={() => setImportIssue(null)}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {importIssue.duplicateDates.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Already on record: {importIssue.duplicateDates.join(", ")}
            </p>
          )}
          {importIssue.problems.length > 0 && (
            <div className="mt-3 max-h-72 overflow-y-auto text-xs">
              {/* Clean, borderless table — Row · Product · Issue · Qty — with a
                  frozen header that stays put while the list scrolls. */}
              <div className="sticky top-0 grid grid-cols-[3rem_1fr_1fr_3rem] gap-3 bg-amber-50 pb-1.5 font-semibold text-amber-800">
                <span>Row</span>
                <span>Product</span>
                <span>Issue</span>
                <span className="text-right">Qty</span>
              </div>
              <div className="text-amber-700">
                {importIssue.problems.map((p, i) => (
                  <div key={i} className="grid grid-cols-[3rem_1fr_1fr_3rem] gap-3 py-1">
                    <span className="tabular-nums">{p.row}</span>
                    <span className="truncate" title={p.product || ""}>{p.product || "—"}</span>
                    <span>{p.issue || p.message || ""}</span>
                    <span className="text-right tabular-nums">{p.qty ?? ""}</span>
                  </div>
                ))}
              </div>
              {importIssue.totalProblems > importIssue.problems.length && (
                <p className="mt-1 text-amber-600">
                  …and {importIssue.totalProblems - importIssue.problems.length} more
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {reportOpen && <SalesReportModal onClose={() => setReportOpen(false)} />}
      {invoicesOpen && <InvoicesModal onClose={() => setInvoicesOpen(false)} onChanged={reload} />}
      {shiftOpen && <PosShiftModal terminal={terminal} onClose={() => setShiftOpen(false)} />}

      {/* Camera barcode scanner — for phones, iPads and any device without a
          hardware scanner. Stays open for continuous scanning; each barcode is
          rung straight into the cart. */}
      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => ringUpByCode(code)} />

      {/* Cart on the LEFT, product grid on the RIGHT (like a menu-first till).
          Only the desktop order is swapped — on mobile the products stay on top
          with the sticky checkout bar below. */}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Scan-first till. Anything WITH a barcode is scan-only, so it never
            clutters the screen. Products with NO barcode can't be scanned (fresh
            food, made-to-order drinks…), so they're laid out here by category for
            the cashier to tap. */}
        {/* min-w-0 so the swipeable category row scrolls INSIDE this column
            instead of stretching the grid and overflowing the page.
            order-2 on desktop puts the products on the RIGHT. */}
        <div className="min-w-0 lg:order-2">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                className="input pl-10"
                placeholder="Search product, Item ID or barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Barcode-scanner path (Sunmi L3): the scanner types the code
                  // then presses Enter. Shared with the hardware/camera scanners
                  // so a typed-in discount label behaves exactly like a scanned
                  // one; failing that, a single filtered result is added too.
                  if (e.key !== "Enter") return;
                  const q = query.trim();
                  if (!q) return;
                  if (ringUpByCode(q)) {
                    setQuery("");
                    return;
                  }
                  const target = filtered.length === 1 ? filtered[0] : null;
                  if (!target) return;
                  // Overselling is allowed — ring it up even at zero stock.
                  addToCart(target);
                  setQuery("");
                }}
                inputMode="search"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="btn-ghost shrink-0"
              title="Scan a barcode with the camera"
            >
              <ScanLine size={18} />
              <span className="hidden sm:inline">Scan</span>
            </button>
          </div>

          {searching ? (
            /* Search results — for a damaged/missing barcode the cashier can
               still find the item by name or Item ID. */
            loading ? (
              <Spinner label="Loading products…" />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                {filtered.slice(0, 24).map((p) => (
                  <ProductCard
                    key={p.id}
                    p={p}
                    onAdd={(x) => {
                      addToCart(x);
                      setQuery("");
                    }}
                    onToggleFavourite={toggleFavourite}
                  />
                ))}
                {filtered.length === 0 && (
                  <p className="col-span-full py-12 text-center text-sm text-slate-400">
                    No products match “{query.trim()}”.
                  </p>
                )}
              </div>
            )
          ) : loading ? (
            <Spinner label="Loading products…" />
          ) : directSaleCount === 0 ? (
            <div className="py-16 text-center">
              <ScanLine className="mx-auto mb-2 text-slate-300" size={26} />
              <p className="text-sm font-semibold text-slate-600">Scan to sell</p>
              <p className="mt-1 text-xs text-slate-400">Every product has a barcode — scan it to add to the sale.</p>
            </div>
          ) : openCat === FAV ? (
            /* The Favourites category — all starred items in one place. */
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button onClick={() => setOpenCat(null)} className="btn-ghost !py-2 text-sm">
                  <ChevronLeft size={16} /> Categories
                </button>
                <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                  <Star size={14} className="text-amber-400" fill="currentColor" /> Favourites
                  <span className="font-normal text-slate-400">· {favourites.length}</span>
                </p>
              </div>
              {favourites.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                  {favourites.map((p) => (
                    <ProductCard key={p.id} p={p} onAdd={addToCart} onToggleFavourite={toggleFavourite} />
                  ))}
                </div>
              ) : (
                <div className="card p-4">
                  <p className="text-[13px] font-semibold text-ink-900">Pin what you sell most</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                    Star an item anywhere on the till and it lives here, one tap away. These are your best sellers so far — tap to pin one.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {favouriteSuggestions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => toggleFavourite(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-ink-900 hover:ring-amber-300"
                      >
                        <Star size={12} className="text-slate-300" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : openGroup ? (
            /* Step 2 — the items inside the chosen category. */
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button onClick={() => setOpenCat(null)} className="btn-ghost !py-2 text-sm">
                  <ChevronLeft size={16} /> Categories
                </button>
                <p className="text-sm font-bold text-ink-900">
                  {openGroup.category} <span className="font-normal text-slate-400">· {openGroup.items.length}</span>
                </p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                {openGroup.items.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={addToCart} onToggleFavourite={toggleFavourite} />
                ))}
              </div>
            </div>
          ) : (
            /* Step 1 — the categories, as a grid that fills the space.
               These used to be one horizontally-scrolling row, which made sense
               when they sat ABOVE a product grid and wrapping would have pushed
               the products off-screen. The till is two-step now: with no
               category open there is nothing underneath to push, so the row only
               hid half the categories off the right edge (no scrollbar to say
               so) and left the rest of the screen empty. Same tile grid as the
               products themselves, so both steps of the till look alike. */
            <div>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Tap a category{" "}
                <span className="font-semibold normal-case tracking-normal text-slate-400">
                  ({directSaleCount} items)
                </span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                {/* Favourites pinned FIRST — same square tile as a category, so
                    the whole grid lines up. */}
                {(favourites.length > 0 || favouriteSuggestions.length > 0) && (
                  <button
                    onClick={() => setOpenCat(FAV)}
                    className="card group flex aspect-square flex-col items-center justify-center gap-0.5 p-1.5 text-center ring-1 ring-amber-200 transition hover:-translate-y-0.5 hover:ring-amber-300 hover:shadow-soft"
                  >
                    <Star size={15} className="text-amber-400" fill="currentColor" />
                    <span className="text-[11.5px] font-bold leading-tight text-ink-900">Favourites</span>
                    <span className="flex items-center gap-0.5">
                      <span className="text-[10px] text-slate-500">
                        {favourites.length} item{favourites.length === 1 ? "" : "s"}
                      </span>
                      <ChevronLeft size={11} className="rotate-180 text-slate-300 transition group-hover:text-amber-500" />
                    </span>
                  </button>
                )}
                {directSaleGroups.map((g) => (
                  <button
                    key={g.category}
                    onClick={() => setOpenCat(g.category)}
                    className="card group flex aspect-square flex-col items-center justify-center gap-0.5 p-1.5 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <span className="line-clamp-3 text-[11.5px] font-bold leading-tight text-ink-900">{g.category}</span>
                    <span className="flex items-center gap-0.5">
                      <span className="text-[10px] text-slate-500">
                        {g.items.length} item{g.items.length === 1 ? "" : "s"}
                      </span>
                      <ChevronLeft
                        size={11}
                        className="rotate-180 text-slate-300 transition group-hover:text-brand-500"
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cart — order-1 on desktop puts it on the LEFT. Sticky and full-height
            on desktop so it stays put and always shows a tall, stable panel
            (not a short card that grows/shrinks with the basket). */}
        <div className="lg:order-1 lg:sticky lg:top-6 lg:self-start">
          <div className="card flex max-h-[calc(100vh-7rem)] flex-col lg:h-[calc(100vh-7rem)]">
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
                    // Fixed columns so every row lines up: name (flex) · stepper ·
                    // line total · bin — same widths on each line regardless of the
                    // product name's length.
                    <div key={lineKey(l.product, l.markdown, l.unit)} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {/* The packaging badge sits OUTSIDE the truncating name:
                            "Case" is the one word the cashier must see, and a
                            long product name would otherwise cut it off. */}
                        <p className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink-800">{l.product.name}</span>
                          {!l.unit.isBase && (
                            <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              {l.unit.name}
                            </span>
                          )}
                        </p>
                        {l.markdown ? (
                          <p className="flex items-center gap-1.5 text-xs">
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              -{l.markdown.percent}%
                            </span>
                            <span className="font-semibold text-amber-700">{usd(l.markdown.price)}</span>
                            <span className="text-slate-400 line-through">{usd(l.markdown.originalPrice)}</span>
                          </p>
                        ) : (
                          <p className="truncate text-xs text-slate-400">
                            {usd(linePrice(l))} each
                            {/* Say what a case actually takes off the shelf — the
                                cashier is counting cases, stock counts cans. */}
                            {!l.unit.isBase &&
                              ` · ${lineBaseQty(l)} ${baseUnitName(l.product)}${lineBaseQty(l) === 1 ? "" : "s"}`}
                          </p>
                        )}
                      </div>
                      {/* Stepper — one rounded control so − / qty / + read as a unit
                          and sit in a fixed-width column on every row. */}
                      <div className="flex shrink-0 items-center rounded-lg bg-slate-100">
                        <button
                          onClick={() => setQty(lineKey(l.product, l.markdown, l.unit), l.qty - 1)}
                          aria-label="Decrease quantity"
                          className="grid h-8 w-8 place-items-center rounded-l-lg text-slate-600 hover:bg-slate-200 active:bg-slate-300"
                        >
                          <Minus size={15} />
                        </button>
                        <span className="w-7 text-center text-sm font-bold tabular-nums text-ink-900">{l.qty}</span>
                        <button
                          onClick={() => setQty(lineKey(l.product, l.markdown, l.unit), l.qty + 1)}
                          aria-label="Increase quantity"
                          className="grid h-8 w-8 place-items-center rounded-r-lg text-slate-600 hover:bg-slate-200 active:bg-slate-300"
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-ink-900">
                        {usd(linePrice(l) * l.qty)}
                      </span>
                      <button
                        onClick={() => setQty(lineKey(l.product, l.markdown, l.unit), 0)}
                        aria-label="Remove item"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 active:bg-rose-100"
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
              {/* Customer selector and manual discount were removed at the
                  owner's request to keep the till simple. `customerId` and
                  `discount` stay at their defaults (Walk-in, no discount) so the
                  checkout still works and automatic promotions still apply. */}

              {/* Pickup number — the cashier flips this on for orders the
                  customer waits for. The number is issued by the server on
                  payment, shared across every till. */}
              <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={() => setWantQueue((v) => !v)}
                  className="flex items-center gap-2"
                  aria-pressed={wantQueue}
                >
                  <span
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                      wantQueue ? "bg-brand-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        wantQueue ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </span>
                  <span className="text-[13px] font-semibold text-ink-800">Pickup number</span>
                </button>
                <input
                  value={terminal}
                  onChange={(e) => saveTerminal(e.target.value)}
                  title="This till's name — saved on this device"
                  className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-xs font-semibold text-ink-800 outline-none focus:border-brand-400"
                />
              </div>

              <div>
                <label className="label">Payment</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPayment(p)}
                      className={`flex items-center justify-center gap-1 rounded-lg py-2.5 text-xs font-bold transition active:scale-[0.98] ${
                        payment === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {p === "KHQR" && <QrCode size={13} />}
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* What the basket has earned. The cashier applies nothing — this
                  is here so they can tell the customer before taking payment. */}
              {promos.length > 0 && (
                <div className="space-y-2 rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200">
                  <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-emerald-700">
                    <Sparkles size={13} /> Promotion applied
                  </p>
                  {promos.map((a) => (
                    <div key={a.promotionId} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-emerald-900">{a.name}</p>
                        <p className="text-[11.5px] text-emerald-700">
                          {a.detail}
                          {a.freeQty > 0 && ` · ${a.freeQty} free`}
                        </p>
                      </div>
                      <span className="shrink-0 text-[13px] font-bold tabular-nums text-emerald-700">
                        - {usd(a.discount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                {promoDiscount > 0 && <Row label="Promotions" value={`- ${usd(promoDiscount)}`} tone="rose" />}
                {manualDiscount > 0 && <Row label="Discount" value={`- ${usd(manualDiscount)}`} tone="rose" />}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-ink-900">Total</span>
                    <span className="block text-[11px] text-slate-400">Includes VAT {Math.round(VAT_RATE * 100)}%</span>
                  </div>
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

      {/* Mobile sticky checkout — keeps "Charge" one tap away on the Sunmi L3
          and phones, where the cart otherwise sits below the product grid.
          Hidden on lg+ where the cart rail is always visible. */}
      {lines.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {cartCount} item{cartCount === 1 ? "" : "s"} · {lines.length} line{lines.length === 1 ? "" : "s"}
              </p>
              <p className="text-lg font-extrabold leading-tight text-ink-900">{usd(total)}</p>
            </div>
            <button onClick={handleCharge} disabled={submitting} className="btn-primary min-w-[9rem] py-3 text-base">
              {payment === "KHQR" && <QrCode size={18} />}
              {submitting ? "Processing…" : payment === "KHQR" ? "Pay KHQR" : "Charge"}
            </button>
          </div>
        </div>
      )}

      {/* KHQR payment modal */}
      {khqrOpen && (
        <KhqrModal
          amount={total}
          billNumber={`MK-${Date.now().toString().slice(-6)}`}
          onCancel={() => setKhqrOpen(false)}
          onConfirmed={async (md5) => {
            try {
              await commitSale({ paymentRef: md5 });
            } catch (e: any) {
              setToast(e.message);
              setKhqrOpen(false);
            }
          }}
        />
      )}

      {/* Cash tender — count the money in, show the change out */}
      {cashOpen && (
        <CashModal
          total={total}
          busy={submitting}
          onCancel={() => setCashOpen(false)}
          onConfirm={async (tendered) => {
            setSubmitting(true);
            try {
              await commitSale({ tendered });
            } catch (e: any) {
              setToast(e.message);
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {/* Receipt modal */}
      {receipt && <ReceiptModal sale={receipt} business={business ?? undefined} onClose={() => setReceipt(null)} />}

      {/* Toast — clears itself (see the effect above) and, while a modal is
          open, sits ABOVE it rather than across its buttons: this is the till,
          and nothing may cover Confirm. */}
      {toast && (
        <div
          className={`fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lift ${
            modalOpen ? "top-6" : "bottom-6"
          }`}
        >
          {toast}
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// One tappable product tile — used for search results and for the
// sell-directly (no barcode) groups.
function ProductCard({
  p,
  onAdd,
  onToggleFavourite,
}: {
  p: Product;
  onAdd: (p: Product) => void;
  onToggleFavourite?: (p: Product) => void;
}) {
  return (
    // `relative` so the star can sit on top: the whole tile is one big button
    // (a cashier taps anywhere to sell), and a button can't legally nest inside
    // another, so the star is a sibling layered over it.
    <div className="group relative">
      {/* Square tile (height = width): image on top, then name, price pinned to
          the bottom — a compact grid the cashier taps to sell. */}
      <button
        onClick={() => onAdd(p)}
        className="card flex aspect-square w-full flex-col p-2 text-left transition hover:-translate-y-0.5 hover:shadow-soft"
      >
        {p.image && (
          <div className="mb-1 h-1/2 w-full overflow-hidden rounded-lg bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/product-image/${p.image}`} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )}
        {/* Name and price only — the cashier taps the tile to sell. Item code,
            stock and status stay on the Inventory screen. `pr-4` keeps the name
            clear of the favourite star in the top-right corner. */}
        <p className="line-clamp-2 pr-4 text-[11.5px] font-semibold leading-tight text-ink-800">{p.name}</p>
        <span className="mt-auto pt-0.5 text-[13px] font-bold text-brand-600">{usd(p.price)}</span>
      </button>

      {onToggleFavourite && (
        <button
          type="button"
          onClick={() => onToggleFavourite(p)}
          title={p.favourite ? "Remove from favourites" : "Add to favourites"}
          aria-label={p.favourite ? `Remove ${p.name} from favourites` : `Add ${p.name} to favourites`}
          aria-pressed={!!p.favourite}
          // Always visible once starred; otherwise it appears on hover/focus so
          // the tile stays clean, but never on touch — where there IS no hover,
          // so it has to be there from the start or it's unreachable.
          className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-lg transition ${
            p.favourite
              ? "text-amber-400 hover:bg-amber-50 hover:text-amber-500"
              : "text-slate-300 hover:bg-slate-100 hover:text-amber-400 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
          }`}
        >
          <Star size={13} fill={p.favourite ? "currentColor" : "none"} />
        </button>
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

function ReceiptModal({ sale, business, onClose }: { sale: Sale; business?: ReceiptBusiness; onClose: () => void }) {
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

        {/* Pickup number — big, so the customer can read it across a counter.
            Only shown when the cashier asked for one at checkout. */}
        {sale.queueNumber != null && (
          <div className="mb-4 rounded-xl bg-brand-50 py-4 text-center ring-1 ring-brand-200">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-700">Pickup Number</p>
            <p className="my-1 text-5xl font-extrabold tabular-nums tracking-wide text-brand-700">
              {formatQueue(sale.queueNumber)}
            </p>
            <p className="text-[12px] text-brand-700/80">Please wait for your number.</p>
          </div>
        )}

        {/* The receipt itself — styled from the store's Invoice Customization. */}
        <ReceiptCard sale={sale} business={business} />

        <button onClick={onClose} className="btn-primary mt-4 w-full">
          New Sale
        </button>
      </div>
    </div>
  );
}

// Recent invoices with a Cancel (void) action. Cancelling is supervisor-only;
// the server puts the stock back, reverses loyalty and drops the sale from every
// report — the row stays, marked Cancelled, so the void is on the record.
const CANCEL_REASONS = [
  "Wrong items rung up",
  "Customer changed mind",
  "Wrong amount / price",
  "Wrong payment method",
  "Duplicate invoice",
  "Other",
];

function InvoicesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useFetch<Sale[]>("/api/sales?limit=200");
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The invoice being cancelled — opens the confirm dialog (reason dropdown +
  // manager approval; the void only goes through with a manager's login).
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [reasonSel, setReasonSel] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const reason = reasonSel === "Other" ? reasonOther.trim() : reasonSel;
  // Manager approval — a store manager / assistant store manager enters their
  // code to authorise the void; the system finds who it belongs to.
  const [mgrPass, setMgrPass] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  function startCancel(s: Sale) {
    setReasonSel("");
    setReasonOther("");
    setMgrPass("");
    setCancelError(null);
    setCancelling(s);
  }

  async function confirmCancel() {
    if (!cancelling || !reason || !mgrPass) return;
    setBusy(cancelling.id);
    setCancelError(null);
    try {
      await api(`/api/sales/${cancelling.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason, managerCode: mgrPass }),
      });
      setCancelling(null);
      reload();
      onChanged();
    } catch (e: any) {
      // Keep the dialog open so the manager can re-enter their code.
      setCancelError(e.message || "Cancellation failed.");
    } finally {
      setBusy(null);
    }
  }

  const query = q.trim().toLowerCase();
  const rows = (data || []).filter(
    (s) =>
      !query ||
      s.invoiceNo.toLowerCase().includes(query) ||
      s.paymentMethod.toLowerCase().includes(query) ||
      (s.customerName || "").toLowerCase().includes(query) ||
      String(s.total).includes(query),
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink-900"><ReceiptText size={18} className="text-brand-600" /> Invoices</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={17} /></button>
        </div>
        {/* Search by invoice number, amount, payment or customer */}
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search invoice no., amount, payment…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
            {q && (
              <button onClick={() => setQ("")} className="shrink-0 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            )}
          </div>
        </div>
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-700">Cancelling an invoice needs a store manager or assistant store manager to approve it with their login code.</p>
        <div className="overflow-y-auto px-2 py-2">
          {loading && !data ? (
            <p className="px-3 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-400">No sales yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Invoice</th>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Pay</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 font-semibold text-ink-800">
                      {s.invoiceNo}
                      {s.cancelled && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">CANCELLED</span>}
                      <span className="block text-[11px] font-normal text-slate-400">{s.items.length} item{s.items.length === 1 ? "" : "s"}{s.customerName ? ` · ${s.customerName}` : ""}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{dateTime(s.createdAt)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${s.cancelled ? "text-slate-400 line-through" : "text-ink-900"}`}>{usd(s.total)}</td>
                    <td className="px-3 py-2 text-slate-500">{s.paymentMethod}</td>
                    <td className="px-3 py-2 text-right">
                      {!s.cancelled && (
                        <button onClick={() => startCancel(s)} disabled={busy === s.id} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          <X size={13} /> {busy === s.id ? "Cancelling…" : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cancel-invoice confirmation — a proper dialog with a reason dropdown.
          The money side is automatic: a cancelled cash sale comes off the
          drawer's expected cash by itself, so nothing is entered twice. */}
      {cancelling && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]" onClick={() => setCancelling(null)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-lift">
            <h4 className="text-base font-bold text-ink-900">Cancel invoice {cancelling.invoiceNo}?</h4>
            <p className="mt-1 text-sm text-slate-500">
              {usd(cancelling.total)} · {cancelling.paymentMethod} · {dateTime(cancelling.createdAt)}
            </p>
            <ul className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] text-slate-600 ring-1 ring-slate-200">
              <li>• Stock goes back on the shelf automatically.</li>
              {cancelling.paymentMethod === "Cash" && (
                <li>• The cash drawer expects {usd(cancelling.total)} less — the refund is automatic, nothing else to record.</li>
              )}
              <li>• The invoice stays on record, marked CANCELLED.</li>
            </ul>
            <div className="mt-3">
              <label className="label">Reason (required)</label>
              <Select
                value={reasonSel}
                onChange={setReasonSel}
                placeholder="Select a reason…"
                options={CANCEL_REASONS.map((r) => ({ value: r, label: r }))}
              />
              {reasonSel === "Other" && (
                <input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Type the reason" className="input mt-2" />
              )}
            </div>

            {/* Manager approval — a store manager / assistant store manager signs
                in here to authorise the void. */}
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
                <ShieldCheck size={13} /> Manager approval
              </p>
              <input
                type="password"
                value={mgrPass}
                onChange={(e) => setMgrPass(e.target.value)}
                placeholder="Manager code"
                autoComplete="off"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") confirmCancel(); }}
                className="input"
              />
              <p className="mt-1.5 text-[11px] text-slate-400">A store manager or assistant store manager enters their code — the system knows who approved.</p>
            </div>

            {cancelError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">{cancelError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setCancelling(null)}>Keep invoice</button>
              <button
                onClick={confirmCancel}
                disabled={!reason || !mgrPass || busy === cancelling.id}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                <X size={15} /> {busy === cancelling.id ? "Cancelling…" : "Approve & cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Notes a cashier can reach for without typing. Only the ones at or above the
// bill are offered — anything smaller can't settle it on its own.
const USD_NOTES = [1, 5, 10, 20, 50, 100];
const RIEL_NOTES = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

function CashModal({
  total,
  busy,
  onCancel,
  onConfirm,
}: {
  total: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (tendered: number) => void;
}) {
  // Customers here pay in both currencies, often in the same handful of notes,
  // so the till counts each and settles the bill against the combined value.
  const [usdIn, setUsdIn] = useState("");
  const [rielIn, setRielIn] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const usdNum = Math.max(0, Number(usdIn) || 0);
  const rielNum = Math.max(0, Number(rielIn) || 0);
  const tendered = Math.round((usdNum + rielNum / EXCHANGE_RATE) * 100) / 100;
  const short = Math.round((total - tendered) * 100) / 100;
  const change = Math.round((tendered - total) * 100) / 100;
  const enough = tendered >= total - 0.005; // a cent of float tolerance
  const touched = usdIn !== "" || rielIn !== "";

  function confirm() {
    if (!enough || busy) return;
    onConfirm(tendered);
  }

  const usdChips = USD_NOTES.filter((n) => n >= total).slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink-900">Cash payment</h3>
            <p className="text-sm text-slate-500">Count what the customer gives you</p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel cash payment"
            className="-mr-2 -mt-1 grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-slate-500">Amount due</span>
            <span className="text-right">
              <span className="block text-xl font-extrabold text-ink-900">{usd(total)}</span>
              <span className="block text-[11px] text-slate-400">{riel(total)}</span>
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="cash-usd">
              Received — US$
            </label>
            <input
              id="cash-usd"
              ref={inputRef}
              className="input text-lg font-bold"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={usdIn}
              onChange={(e) => setUsdIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setUsdIn(total.toFixed(2));
                  setRielIn("");
                }}
                className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200"
              >
                Exact
              </button>
              {usdChips.map((n) => (
                <button
                  key={n}
                  onClick={() => setUsdIn(String(n))}
                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200"
                >
                  ${n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="cash-riel">
              Received — Riel
            </label>
            <input
              id="cash-riel"
              className="input text-lg font-bold"
              type="number"
              inputMode="numeric"
              min={0}
              step="100"
              placeholder="0"
              value={rielIn}
              onChange={(e) => setRielIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RIEL_NOTES.map((n) => (
                <button
                  key={n}
                  onClick={() => setRielIn(String((Number(rielIn) || 0) + n))}
                  className="rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200"
                >
                  +{num(n)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Change / shortfall — the whole reason this screen exists */}
        <div
          className={`mt-4 rounded-xl px-4 py-3 ${
            !touched ? "bg-slate-50" : enough ? "bg-emerald-50" : "bg-amber-50"
          }`}
        >
          {!touched ? (
            <p className="text-center text-sm text-slate-400">Enter the cash received</p>
          ) : enough ? (
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-emerald-700">Change</span>
              <span className="text-right">
                <span className="block text-2xl font-extrabold text-emerald-700">{usd(change)}</span>
                <span className="block text-[11px] font-semibold text-emerald-600">{riel(change)}</span>
              </span>
            </div>
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-amber-700">Still short</span>
              <span className="text-right">
                <span className="block text-xl font-extrabold text-amber-700">{usd(short)}</span>
                <span className="block text-[11px] font-semibold text-amber-600">{riel(short)}</span>
              </span>
            </div>
          )}
          {touched && (usdNum > 0 || rielNum > 0) && (
            <p className="mt-1.5 border-t border-white/70 pt-1.5 text-[11px] text-slate-500">
              Tendered {usd(tendered)}
              {rielNum > 0 && usdNum > 0 && ` · $${usdNum.toFixed(2)} + ${riel(rielNum / EXCHANGE_RATE)}`}
            </p>
          )}
        </div>

        <button onClick={confirm} disabled={!enough || busy} className="btn-primary mt-4 w-full py-3 text-base">
          {busy ? "Processing…" : enough ? `Confirm · change ${usd(change)}` : "Confirm"}
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
  // Local-timezone yyyy-mm-dd so the calendar pickers never slip a day.
  const toKey = (dt: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  const today = toKey(new Date());
  const yesterday = toKey(new Date(Date.now() - 86_400_000));

  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(yesterday); // sales are ~1 day behind, so default to yesterday
  const [rangeFrom, setRangeFrom] = useState(() => toKey(new Date(Date.now() - 6 * 86_400_000)));
  const [rangeTo, setRangeTo] = useState(today);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");

  const from = mode === "day" ? day : rangeFrom;
  const to = mode === "day" ? day : rangeTo;
  const query = `from=${from}&to=${to}`;
  const { data, loading } = useFetch<SalesReportData>(`/api/sales-report?${query}`);
  const exportHref = (fmt: string) => `/api/sales-report/export?format=${fmt}&${query}`;
  // Quick presets just set the From/To dates; the user can then fine-tune either.
  const presets = [
    { label: "7 days", days: 7 },
    { label: "14 days", days: 14 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ];
  const applyPreset = (n: number) => {
    setRangeTo(today);
    setRangeFrom(toKey(new Date(Date.now() - (n - 1) * 86_400_000)));
  };
  const activePreset =
    rangeTo === today
      ? presets.find((p) => rangeFrom === toKey(new Date(Date.now() - (p.days - 1) * 86_400_000)))?.days ?? 0
      : 0;
  const { role, caps } = useAccess();
  const showProfit = role == null || canSeeProfit(role, caps);

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
  // Group the filtered items by category (best-selling category first).
  const groups = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const it of items) (m.get(it.category) ?? m.set(it.category, []).get(it.category)!).push(it);
    return [...m.entries()]
      .map(([category, its]) => ({
        category,
        items: its,
        qty: its.reduce((s, x) => s + x.qty, 0),
        revenue: its.reduce((s, x) => s + x.revenue, 0),
        cost: its.reduce((s, x) => s + x.cost, 0),
        profit: its.reduce((s, x) => s + x.profit, 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items]);
  const shown = useMemo(
    () =>
      items.reduce(
        (a, it) => ({ qty: a.qty + it.qty, revenue: a.revenue + it.revenue, cost: a.cost + it.cost, profit: a.profit + it.profit }),
        { qty: 0, revenue: 0, cost: 0, profit: 0 },
      ),
    [items],
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-brand-600" />
            <h3 className="text-base font-bold text-ink-900">Sales Report — by category</h3>
          </div>
          <div className="flex items-center gap-2">
            <a href={exportHref("xlsx")} className="btn-ghost !py-2 text-sm">
              <FileSpreadsheet size={15} /> Excel
            </a>
            <a href={exportHref("pdf")} className="btn-ghost !py-2 text-sm">
              PDF
            </a>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Period: a single day (pick the date) or a recent range */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {(["day", "range"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    mode === m ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {m === "day" ? "A day" : "Range"}
                </button>
              ))}
            </div>
            {mode === "day" ? (
              <DatePicker value={day} max={today} onChange={setDay} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                  {presets.map((p) => (
                    <button
                      key={p.days}
                      onClick={() => applyPreset(p.days)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                        activePreset === p.days ? "bg-white text-ink-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span>From</span>
                  <DatePicker value={rangeFrom} max={rangeTo} onChange={setRangeFrom} />
                  <span>to</span>
                  <DatePicker value={rangeTo} min={rangeFrom} max={today} onChange={setRangeTo} />
                </div>
              </div>
            )}
          </div>

          {loading || !data ? (
            <div className="grid h-40 place-items-center text-sm text-slate-400">Loading…</div>
          ) : data.totals.sales === 0 ? (
            <div className="grid h-40 place-items-center px-6 text-center text-sm text-slate-400">
              No sales {mode === "day" ? `on ${day}` : `from ${rangeFrom} to ${rangeTo}`}. Pick another date, or import that day&apos;s sales.
            </div>
          ) : (
            <>
              {/* Filter: a searchable category picker + item search */}
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

              {/* Totals for the current period + filter */}
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Items", value: num(items.length) },
                  { label: "Units sold", value: num(shown.qty) },
                  { label: "Revenue", value: usd(shown.revenue) },
                  ...(showProfit ? [{ label: "Cost", value: usd(shown.cost) }] : []),
                  ...(showProfit ? [{ label: "Profit", value: usd(shown.profit) }] : []),
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
                    <p className="mt-1 text-lg font-bold text-ink-900">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Grouped by category */}
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.category} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-3.5 py-2.5">
                      <p className="text-sm font-bold text-ink-900">{g.category}</p>
                      <p className="text-xs font-semibold text-slate-500">
                        {num(g.qty)} sold · <span className="text-ink-800">{usd(g.revenue)}</span>
                        {showProfit && <> · <span className="text-emerald-600">{usd(g.profit)} profit</span></>}
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          <th className="px-3.5 py-1.5 text-left">Item</th>
                          <th className="px-3 py-1.5 text-right">Qty</th>
                          <th className="px-3 py-1.5 text-right">Revenue</th>
                          {showProfit && <th className="px-3 py-1.5 text-right">Cost</th>}
                          {showProfit && <th className="px-3.5 py-1.5 text-right">Profit</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it) => (
                          <tr key={it.sku} className="border-b border-slate-50 last:border-0">
                            <td className="px-3.5 py-2">
                              <p className="font-medium text-ink-800">{it.name}</p>
                              <p className="text-[11px] text-slate-400">{it.sku}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-ink-800">{num(it.qty)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{usd(it.revenue)}</td>
                            {showProfit && <td className="px-3 py-2 text-right text-slate-500">{usd(it.cost)}</td>}
                            {showProfit && <td className="px-3.5 py-2 text-right text-emerald-600">{usd(it.profit)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {groups.length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-400">No items match this filter.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
