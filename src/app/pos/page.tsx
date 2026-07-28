"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { barcodeIncludes } from "@/lib/barcodes";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  ShoppingCart,
  CheckCircle2,
  X,
  Ticket,
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
  Vault,
  Scale,
  Lock,
  MonitorCheck,
  ArrowLeftRight,
  Landmark,
  PauseCircle,
  PlayCircle,
  Clock,
  WifiOff,
} from "lucide-react";
import { useFetch, api, useAccess } from "@/lib/client";
import { useTillMode } from "@/lib/tillmode";
import { ManagerGate } from "@/components/ManagerGate";
import type { Product, Customer, Sale, PaymentMethod, Markdown, OptionGroup, SaleItemOption } from "@/lib/types";
import { isMarkdownCode, isSellable, markdownStatus, storeToday } from "@/lib/markdowns";
import { PageHeader, Spinner, ErrorBox, Badge, Modal } from "@/components/ui";
import { usd, riel, rielDue, num, EXCHANGE_RATE, dateTime, invoiceDateTime } from "@/lib/format";
import { publishCustomerDisplay } from "@/lib/customerDisplay";
import { loadHeld, saveHeld, type HeldOrder } from "@/lib/heldOrders";
import { SearchSelect } from "@/components/SearchSelect";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { CameraScanner } from "@/components/CameraScanner";
import { canSeeProfit } from "@/lib/access";
import { formatQueue } from "@/lib/queue";
import { localizeQueueCode, type QueueNumberStyle } from "@/lib/khmer";
import { hasThermalPrinter, printThermalReceipt, buildReceiptPayload } from "@/lib/printer";
import { ReceiptCard, type ReceiptBusiness } from "@/components/Receipt";
import { PosShiftModal, type ShiftAction } from "@/components/PosShiftModal";
import { isShownOnPos } from "@/lib/pos";
import { groupsForProduct, optionsKey, optionsPrice, optionsLabel } from "@/lib/options";
import type { PromotionApplication as PromoApplication } from "@/lib/promotions";
import { baseUnitName, defaultUnitOf, findByBarcode, packagingMatches, type ResolvedUnit } from "@/lib/sellingUnits";

// A discounted line and a full-price line for the SAME product can sit in one
// sale (the customer grabbed one reduced loaf and one fresh), so the markdown
// is part of the line — and part of its cart key. So is the packaging: a can
// and a case of the same drink are two lines, priced differently.
//
// `qty` here counts the UNIT the line is sold in — 2 means two cases. The base
// quantity is only worked out when the sale is sent, which keeps the +/- buttons
// meaning what the cashier expects: one more case, not one more can.
type CartLine = { product: Product; qty: number; seq: number; markdown?: Markdown; unit: ResolvedUnit; options?: SaleItemOption[] };

function lineKey(product: Product, markdown?: Markdown, unit?: ResolvedUnit, options?: SaleItemOption[]): string {
  const u = unit && !unit.isBase ? `::${unit.id}` : "";
  // The condiments are part of the identity of a line: a mild bowl and a
  // level-5 bowl of the same noodle must stay apart, or the kitchen gets one
  // ticket for a dish that has to be cooked two different ways.
  const o = optionsKey(options);
  const opt = o ? `::${o}` : "";
  return markdown ? `${product.id}::${markdown.code}${u}${opt}` : `${product.id}${u}${opt}`;
}
/** What one of whatever this line sells costs. */
function linePrice(l: CartLine): number {
  const extra = optionsPrice(l.options) * l.unit.conversion;
  if (l.markdown) return l.markdown.price * l.unit.conversion + extra;
  return l.unit.price + extra;
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

// Payment buttons shown on the till. KHQR and Wing are intentionally omitted —
// the store takes Cash, ABA (which shows its own KHQR to scan) and Card.
// What the till can be paid with. "Card" is deliberately absent — this shop
// takes cash and ABA, and a third button only invited a mis-tap that files the
// money under a method the store doesn't have.
//
// The TYPE still allows Card, and the shift report still totals it: sales
// already recorded that way must keep reading correctly. This removes the
// choice going forward, not the history.
const PAYMENTS: PaymentMethod[] = ["Cash", "ABA"];
const VAT_RATE = 0.1;

export default function PosPage() {
  // The catalogue is loaded once when the till starts and then left alone —
  // it's the biggest feed in the app and it changes in the office, not at the
  // counter. Refreshed overnight, or on demand from Sync catalogue. Everything
  // below stays live, because it does change while the shop trades.
  const { data: products, loading, error, reload } = useFetch<Product[]>("/api/products", { policy: "catalog" });
  const { data: customers, reload: reloadCustomers } = useFetch<Customer[]>("/api/customers");
  const { data: markdowns } = useFetch<Markdown[]>("/api/markdowns");
  // What actually sells — used to offer the obvious favourites rather than
  // making someone hunt for their own best sellers through the categories.
  const { data: salesReport } = useFetch<{ byItem: { productId: string; qty: number }[] }>("/api/sales-report");
  // Store profile + receipt styling for the printed receipt (Invoice Customization).
  const { data: business } = useFetch<ReceiptBusiness>("/api/business");
  // On a till (Till Mode device), the page drops its title, exports and reports —
  // just the sale, the cash drawer and invoices.
  const { tillMode, setTillMode } = useTillMode();
  // Owner-gated switch to turn this device into a till, right from the POS.
  const [tillGate, setTillGate] = useState(false);

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const cartSeq = useRef(0);
  const [promos, setPromos] = useState<PromoApplication[]>([]);
  const promoSeq = useRef(0); // guards against out-of-order preview replies
  // Favourite stars tapped but not yet confirmed by the server, id → next value.
  const [favPending, setFavPending] = useState<Record<string, boolean>>({});
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  // The one coupon on this sale. Held as what the server said it was worth at
  // scan time; the server checks it again for real when the sale commits.
  const [coupon, setCoupon] = useState<{ code: string; name: string; detail: string; discount: number } | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("Cash");
  // Pickup number: the cashier turns this on for orders the customer waits for
  // (coffee, noodles, warmed food). The server issues the number centrally.
  const [wantQueue, setWantQueue] = useState(false);
  // This till's identifier, saved per device so every sale, drawer count and
  // queue number is filed under the right till. READ ONLY here — it is assigned
  // once by the owner from the till menu (see components/TillBar).
  const [terminal, setTerminal] = useState("POS 1");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("stookii_pos_terminal") : null;
    if (saved) setTerminal(saved);
  }, []);
  // Held (parked) orders — per till, kept on the device so Hold/Resume works
  // offline. Loaded once the till id is known; refreshed whenever it changes.
  const [held, setHeld] = useState<HeldOrder<Record<string, CartLine>>[]>([]);
  const [resumeOpen, setResumeOpen] = useState(false);
  useEffect(() => {
    setHeld(loadHeld<Record<string, CartLine>>(terminal));
  }, [terminal]);
  const [submitting, setSubmitting] = useState(false);
  const [khqrOpen, setKhqrOpen] = useState(false);
  const [khqrBill, setKhqrBill] = useState("");
  const [cashOpen, setCashOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  // The cash shift, opened right here in the till: live drawer summary + close.
  // `shiftAction` jumps straight to Safe Drop / Survey / Close from the quick
  // buttons under the categories.
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftAction, setShiftAction] = useState<ShiftAction | undefined>(undefined);
  const openShift = (action?: ShiftAction) => {
    setShiftAction(action);
    setShiftOpen(true);
  };
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
  // The reference for the checkout attempt in flight (see commitSale). Held
  // across a failed attempt so a retry dedupes, and released once the sale has
  // landed so the NEXT customer is a new sale.
  const chargeRef = useRef<string>("");
  // Bring a freshly scanned line into view and mark it.
  //
  // The newest line is at the TOP of the basket, so once the cashier has
  // scrolled down through a big order the next scan lands out of sight — they
  // are left guessing whether the beep registered, and the usual answer is to
  // scan it again. Scrolling back and ringing the row for a moment answers the
  // only question they have: did that go in?
  const [justAdded, setJustAdded] = useState<number | null>(null);
  // The item waiting on a condiment choice. Held rather than added straight to
  // the basket: a noodle with no spice level is a ticket the kitchen can't cook.
  const [asking, setAsking] = useState<{
    product: Product;
    markdown?: Markdown;
    unit: ResolvedUnit;
    groups: OptionGroup[];
  } | null>(null);
  useEffect(() => {
    if (justAdded == null) return;
    // Scroll the NEW LINE into view rather than a container we picked in
    // advance: on a till the whole column scrolls, in the full app the basket
    // scrolls inside it, and scrollIntoView finds whichever ancestor it is.
    // Runs after the render that added the row, so the row exists.
    document.querySelector('[data-newest="1"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Let the ring fade after a beat — it marks the newest line, it isn't a
    // permanent selection.
    const t = setTimeout(() => setJustAdded(null), 1400);
    return () => clearTimeout(t);
  }, [justAdded]);
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

  // Each result carries the SALE UNIT it should show as. An exact barcode/code
  // hit pins the tile to that unit — scan or type a pack's code and the result
  // is the pack (its name + price), not the single — because the shop sells the
  // same product in unit, pack and carton, each with its own code.
  const filtered = useMemo(() => {
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) return [] as { product: Product; unit: ResolvedUnit }[];
    const results: { product: Product; unit: ResolvedUnit }[] = [];
    for (const p of catalog) {
      const hit = findByBarcode([p], raw);
      if (hit) {
        results.push({ product: p, unit: hit.unit });
        continue;
      }
      // A looser match (part of a name, code or barcode) shows the default unit.
      if (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        barcodeIncludes(p, q) ||
        packagingMatches(p, q)
      ) {
        results.push({ product: p, unit: defaultUnitOf(p) });
      }
    }
    return results;
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
          options: l.options?.length
            ? l.options.map((o) => ({ groupId: o.groupId, choiceId: o.choiceId }))
            : undefined,
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
  // The coupon comes off LAST, after promotions and the cashier's discount —
  // it discounts what the customer would otherwise have paid. Recalculated
  // whenever the basket changes, so removing an item can't leave a $5 voucher
  // sitting on a $3 basket.
  const afterDeals = Math.max(0, gross - manualDiscount - promoDiscount);
  const couponOff = coupon ? Math.min(coupon.discount, afterDeals) : 0;
  // Read by the scan handler, which is created once and would otherwise send
  // the basket total as it stood when the till was opened.
  const afterDealsRef = useRef(afterDeals);
  afterDealsRef.current = afterDeals;
  const discountNum = Math.min(manualDiscount + promoDiscount + couponOff, gross);
  const total = gross - discountNum; // what the customer pays (VAT included)
  const subtotal = total / (1 + VAT_RATE); // net of the included VAT
  const tax = total - subtotal; // VAT already contained in the price

  // Overselling is allowed: items can be rung up past the on-hand count, which
  // simply lets stock go negative (-1, -2, …). No quantity cap here.
  // `unit` omitted = whatever the product's default packaging is (the base unit
  // unless someone set a pack as default), which is what tapping a tile means.
  function addToCart(product: Product, markdown?: Markdown, unit?: ResolvedUnit, options?: SaleItemOption[]) {
    const u = unit || defaultUnitOf(product);
    // Made-to-order items have to be asked about before they can go in the
    // basket: a noodle with no spice level is a ticket the kitchen cannot cook
    // from. Tapping the tile opens the chooser and comes back through here with
    // the answer.
    if (!options) {
      const groups = groupsForProduct(business?.optionGroups, product);
      if (groups.length) {
        setAsking({ product, markdown, unit: u, groups });
        return;
      }
    }
    // A product with no selling price would ring up FREE — the customer walks out
    // with stock the store paid for. Refuse it at the till; a price is a manager
    // fix in Products, not something a cashier can sort out with a queue waiting.
    // (Giving something away on purpose is what the discount field is for.)
    // Mirrors linePrice() above, so the check is on what this line would ACTUALLY charge.
    const unitPrice = markdown ? markdown.price * u.conversion : u.price;
    if (!(unitPrice > 0)) {
      setToast(`"${product.name}" has no price set — it can't be sold until a manager adds one.`);
      return;
    }
    const key = lineKey(product, markdown, u, options);
    setCart((prev) => {
      const existing = prev[key];
      const qty = (existing?.qty || 0) + 1;
      cartSeq.current += 1; // bump so the just-scanned line floats to the top
      return { ...prev, [key]: { product, qty, seq: cartSeq.current, markdown, unit: u, options } };
    });
    // Show the cashier it went in: jump the basket back to the new line and ring
    // it briefly. Without this, a scan during a long order lands above the fold
    // and gets scanned a second time.
    setJustAdded(cartSeq.current);
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
    // The coupon belongs to the basket, not the till: leaving it attached would
    // silently discount the NEXT customer's sale.
    setCoupon(null);
    setCustomerId("");
    setPayment("Cash");
  }

  // Staff swap at the till refreshes the session in place (no page reload) — so
  // start a fresh, empty sale for the person taking over the till.
  useEffect(() => {
    const onStaffChanged = () => clearCart();
    window.addEventListener("stookii-staff-changed", onStaffChanged);
    return () => window.removeEventListener("stookii-staff-changed", onStaffChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hold / Resume — park the current sale on this till and serve the next
  // customer, then recall it. Device-local, so it works with no internet.
  const snapshotCart = (): HeldOrder<Record<string, CartLine>> => ({
    id: `H${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    total,
    count: cartCount,
    customerId,
    discount,
    wantQueue,
    cart,
  });
  function holdOrder() {
    if (lines.length === 0) return;
    const list = [snapshotCart(), ...held];
    setHeld(list);
    saveHeld(terminal, list);
    clearCart();
    setWantQueue(false);
  }
  function resumeOrder(o: HeldOrder<Record<string, CartLine>>) {
    // Take the chosen order OUT of the held list, and if a sale is in progress
    // park it in the same step so nothing is lost (computed atomically to avoid
    // a stale-state race between the two updates).
    let list = held.filter((h) => h.id !== o.id);
    if (lines.length > 0) list = [snapshotCart(), ...list];
    setHeld(list);
    saveHeld(terminal, list);
    setCart(o.cart);
    setDiscount(o.discount || "");
    // A held basket comes back WITHOUT its coupon. The voucher was never spent
    // (nothing is reserved at scan time), and its value depends on a basket
    // that may have been edited since — so it is rescanned rather than restored
    // at a figure that might now be wrong.
    setCoupon(null);
    setCustomerId(o.customerId || "");
    setWantQueue(!!o.wantQueue);
    setResumeOpen(false);
  }
  function deleteHeld(id: string) {
    const list = held.filter((h) => h.id !== id);
    setHeld(list);
    saveHeld(terminal, list);
  }

  // Shared scan handler for BOTH scan paths (hardware keyboard-wedge scanner and
  // the on-screen camera scanner): find the product by barcode or SKU and ring
  // it straight into the cart. Returns whether a product was matched.
  /**
   * A scanned code that matched no product — is it a coupon?
   *
   * Asks the server, because whether a voucher has already been spent is not
   * something the till can know. Nothing is reserved by asking: the coupon is
   * only spent when the sale commits, so a cashier can scan it, change their
   * mind, and the customer still has a valid coupon.
   */
  async function tryCoupon(code: string) {
    try {
      const res = await fetch("/api/coupons/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, basketTotal: afterDealsRef.current }),
      });
      if (res.status === 404) {
        setToast(`Barcode ${code} isn't in the system.`);
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        // Why it was refused, in words the cashier can say to the customer.
        setToast(data.reason || "That coupon can't be used.");
        return;
      }
      // One coupon per sale. Scanning a second replaces the first rather than
      // stacking — stacking is a policy question, and a counter is the wrong
      // place to answer it.
      setCoupon({ code: data.code, name: data.name, detail: data.detail, discount: data.discount });
      setToast(`${data.name} — ${data.detail}`);
    } catch {
      setToast("Couldn't check that coupon — try again.");
    }
  }

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
    if (!hit) {
      // Not a product. It may be a coupon the customer handed over — checked
      // against the server, because only the server knows whether this voucher
      // has already been spent. Fire-and-forget so the scan gun isn't blocked
      // waiting on the network; the answer arrives as a toast a moment later.
      void tryCoupon(q);
      // Claim the scan either way: returning false would drop the code into the
      // search box, and "930000004" as a search term helps nobody.
      return true;
    }
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

      // A dialog owns the screen — but IGNORING the scan is not enough, because
      // the scanner is a keyboard: its digits still land in whatever field has
      // focus. With the cash dialog open and "Received US$" focused, scanning
      // the customer's next item typed a 13-digit barcode straight into the
      // amount. One real receipt read "Received (USD) $88,460,000,187,400" —
      // and the till then jammed on a sale that could never balance.
      //
      // So: watch the burst here too, and when it ends in Enter and is long
      // enough to be a barcode, swallow it and wipe what it typed.
      if (blockScanRef.current) {
        const t = Date.now();
        if (t - last > 120) buf = "";
        last = t;
        if (e.key === "Enter") {
          const looksScanned = buf.length >= 8; // barcodes are 8–14 digits
          buf = "";
          if (looksScanned) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // Undo the damage: the digits already reached the focused box.
            const el = document.activeElement as HTMLInputElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
              const setter = Object.getOwnPropertyDescriptor(
                el.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
                "value",
              )?.set;
              setter?.call(el, "");
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
            setToast("Finish this payment first — scan ignored");
          }
          return;
        }
        if (e.key.length === 1) buf += e.key;
        return;
      }

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

  async function commitSale(opts?: { paymentRef?: string; tendered?: number; tenderedUsd?: number; tenderedRiel?: number }) {
    // A real sale is only ever recorded on a locked till (see handleCharge). This
    // is the last line of defence so no payment path can commit a sale otherwise.
    if (!tillMode) {
      setTillGate(true);
      return;
    }
    // One reference per checkout attempt, kept until the sale actually lands.
    //
    // If the reply is lost — shop wifi stalling, the request timing out on the
    // device while the server has already committed — the cashier sees an error
    // and no receipt, and presses Charge again. Sending the SAME reference makes
    // the server hand back the sale it already made, instead of recording a
    // second one and deducting the stock twice for a customer who paid once.
    if (!chargeRef.current) chargeRef.current = `${terminal}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
          // How the customer wants it made. IDs only — the server re-reads the
          // names and any price from the store's own record, so the till can't
          // invent a label the kitchen never agreed to.
          options: l.options?.length
            ? l.options.map((o) => ({ groupId: o.groupId, choiceId: o.choiceId }))
            : undefined,
        })),
        customerId: customerId || null,
        // ONLY the cashier's typed discount. The promotion part of `discountNum`
        // is the server's own to work out — sending it back would have it
        // counted twice.
        discount: manualDiscount,
        // Only the CODE. What it is worth is the server's to decide — sending
        // an amount would be handing the till a blank cheque.
        couponCode: coupon?.code,
        paymentMethod: payment,
        paymentRef: opts?.paymentRef,
        tendered: opts?.tendered,
        tenderedUsd: opts?.tenderedUsd,
        tenderedRiel: opts?.tenderedRiel,
        // Ask the server for a pickup number only when the cashier turned it on.
        queue: wantQueue,
        posTerminalId: terminal,
        clientRef: chargeRef.current,
      }),
    });
    // Second screen: show the customer "thank you" + their change, and hold that
    // view (don't let clearing the cart flip it back to idle) until the next scan.
    const paid = opts?.tendered;
    const changeDue =
      typeof paid === "number" ? Math.max(0, Math.round((paid - total) * 100) / 100) : undefined;
    publishCustomerDisplay({
      kind: "thanks",
      storeName,
      total,
      paid,
      change: changeDue,
      method: payment,
    });
    suppressIdleRef.current = true;
    chargeRef.current = ""; // this sale is on record — the next one is new
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
    // Real sales are only rung up on a locked till: every sale must attribute to a
    // shift's drawer, and an owner/manager browsing the POS in the full app must
    // not be able to record a sale by accident. Prompt to turn Till Mode on.
    if (!tillMode) {
      setTillGate(true);
      return;
    }
    // Digital payment: show the KHQR for the customer to scan (ABA Mobile and
    // every Cambodian bank app read KHQR), wait for the payment, then commit and
    // print the receipt. ABA is paid this way too — one QR, scanned in ABA.
    if (payment === "KHQR" || payment === "ABA") {
      // Mint the bill number ONCE, here. It used to be built inline in the JSX,
      // which re-ran on every render — and this page re-renders every ~20s from
      // the background polling. That silently replaced the QR (and its md5)
      // while the customer was mid-scan: they paid the code they were looking
      // at, the till was already watching a different one, and the sale never
      // completed. The QR must stay fixed for as long as the dialog is open.
      setKhqrBill(`MK-${Date.now().toString().slice(-6)}`);
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

  // Mirror the sale onto the customer-facing second screen (Sunmi T3). When a
  // payment dialog owns the screen (KHQR shows its own QR; a finished sale shows
  // "thank you") we hold off so this effect doesn't overwrite it — the ref is
  // set true right after publishing "thanks", so clearing the cart afterwards
  // doesn't immediately flip the customer screen back to idle.
  // What the CUSTOMER screen calls this shop: the name the store was created
  // with, not the separately-edited business profile field. The two drifted, and
  // the customer was reading the wrong one.
  const storeName = business?.storeName || business?.name || "ON Mart";
  const suppressIdleRef = useRef(false);
  useEffect(() => {
    if (khqrOpen) return; // the KHQR dialog publishes its own view
    if (lines.length > 0) {
      suppressIdleRef.current = false;
      publishCustomerDisplay({
        kind: "sale",
        storeName,
        itemCount: cartCount,
        total,
        discount: discountNum,
        lines: lines.map((l) => ({
          name: l.product.name,
          qty: l.qty,
          lineTotal: linePrice(l) * l.qty,
          unitLabel: l.unit.isBase ? undefined : l.unit.name,
        })),
      });
    } else {
      if (suppressIdleRef.current) {
        suppressIdleRef.current = false; // keep "thank you" up until the next scan
        return;
      }
      publishCustomerDisplay({ kind: "idle", storeName });
    }
  }, [lines, total, discountNum, cartCount, khqrOpen, storeName]);

  return (
    <div className={`${tillMode ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col" : ""} ${lines.length > 0 ? "pb-24 lg:pb-0" : ""}`.trim() || undefined}>
      {tillMode ? (
        // On a till there's no top toolbar — Cash Drawer & Invoices live down in
        // the SHIFT quick-actions block, next to Safe Drop / Survey / Close.
        null
      ) : (
        <PageHeader
          title="Point of Sale"
          subtitle="Ring up a sale — stock and loyalty update automatically"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/money"
                className="btn-ghost !py-2 text-sm"
                title="Cash drawer, store safe & reports"
              >
                <Wallet size={16} /> Cash Management
              </Link>
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
              {/* Turn this device into a locked till — owner password required. */}
              <button
                className="btn-ghost !py-2 text-sm ring-1 ring-brand-200 text-brand-700"
                onClick={() => setTillGate(true)}
                title="Lock this device to the POS screen only"
              >
                <MonitorCheck size={16} /> Till Mode
              </button>
            </div>
          }
        />
      )}

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
      {shiftOpen && (
        <PosShiftModal
          terminal={terminal}
          initialAction={shiftAction}
          onClose={() => {
            setShiftOpen(false);
            setShiftAction(undefined);
          }}
        />
      )}

      {/* Camera barcode scanner — for phones, iPads and any device without a
          hardware scanner. Stays open for continuous scanning; each barcode is
          rung straight into the cart. */}
      <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(code) => ringUpByCode(code)} />

      {/* Cart on the LEFT, product grid on the RIGHT (like a menu-first till).
          Only the desktop order is swapped — on mobile the products stay on top
          with the sticky checkout bar below. */}
      {/* On a till the split is a fixed 40 / 60 (cart / products) — a clean
          proportion that fills any screen the same way. The back-office POS keeps
          its comfortable fixed-width cart. */}
      <div className={`grid gap-6 ${tillMode ? "lg:grid-cols-[2fr_3fr] lg:min-h-0 lg:flex-1 lg:grid-rows-1" : "lg:grid-cols-[500px_1fr] xl:grid-cols-[600px_1fr] 2xl:grid-cols-[720px_1fr]"}`}>
        {/* Scan-first till. Anything WITH a barcode is scan-only, so it never
            clutters the screen. Products with NO barcode can't be scanned (fresh
            food, made-to-order drinks…), so they're laid out here by category for
            the cashier to tap. */}
        {/* min-w-0 so the swipeable category row scrolls INSIDE this column
            instead of stretching the grid and overflowing the page.
            order-2 on desktop puts the products on the RIGHT. */}
        {/* On a till the product side is a contained card, matching the Current
            Sale panel — one clean frame instead of loose elements on the page. */}
        <div className={`min-w-0 lg:order-2 ${tillMode ? "card p-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col" : ""}`}>
          <div className={`mb-4 flex items-center gap-2 ${tillMode ? "lg:shrink-0" : ""}`}>
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
                  // Overselling is allowed — ring it up even at zero stock. Ring
                  // up the unit the single result is showing (pack/carton/single).
                  addToCart(target.product, undefined, target.unit);
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

          {/* On a till this is the ONLY thing that scrolls — the frame, header
              and cart stay pinned so the screen never moves. */}
          {/* p-1/-m-1: the scroll box clips anything outside its edge, which was
              shaving the 1px border off the left column of tiles — a sliver of
              padding keeps every box border fully visible without moving them. */}
          <div className={tillMode ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:-m-1 lg:pr-1" : ""}>
          {searching ? (
            /* Search results — for a damaged/missing barcode the cashier can
               still find the item by name or Item ID. */
            loading ? (
              <Spinner label="Loading products…" />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {filtered.slice(0, 24).map((r) => (
                  <ProductCard
                    key={`${r.product.id}:${r.unit.id}`}
                    p={r.product}
                    unit={r.unit}
                    onAdd={(x, u) => {
                      // Rings up the exact unit shown on the tile — the pack when
                      // a pack code matched, the single otherwise.
                      addToCart(x, undefined, u);
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
          ) : error && !products ? (
            /* The catalogue could not be fetched. Say so plainly, with a way back:
               an empty grid here reads as "this store has no products", which
               sends the cashier hunting for a problem that is not there. */
            <div className="py-16 text-center">
              <WifiOff className="mx-auto mb-2 text-rose-300" size={26} />
              <p className="text-sm font-semibold text-slate-600">Could not load the products</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">{error}</p>
              <button onClick={reload} className="btn-primary mt-4 px-5 py-2.5 text-sm">
                Try again
              </button>
            </div>
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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                  {favourites.map((p) => (
                    <ProductCard key={p.id} p={p} onAdd={(x) => addToCart(x)} onToggleFavourite={toggleFavourite} />
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {openGroup.items.map((p) => (
                  <ProductCard key={p.id} p={p} onAdd={(x) => addToCart(x)} onToggleFavourite={toggleFavourite} />
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
            <div className={tillMode ? "lg:flex lg:h-full lg:flex-col" : ""}>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Tap a category{" "}
                <span className="font-semibold normal-case tracking-normal text-slate-400">
                  ({directSaleCount} items)
                </span>
              </p>
              {/* CATEGORIES stay narrow. Widening these to fit long product
                  names was a mistake: a category name is two short words, so the
                  extra width bought nothing and cost a column — which pushed the
                  TILL row off the bottom of the T3 and made the cashier scroll
                  to reach it. The wide tiles are for PRODUCTS, where the names
                  actually are long. */}
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

              {/* Shift quick actions — Safe Drop / Shift Survey / Close Shift,
                  one tap from the till instead of opening the Cash Drawer first.
                  Each opens the shift screen straight into that action. */}
              <div className={`mt-5 border-t border-slate-100 pt-4 ${tillMode ? "lg:mt-auto" : ""}`}>
                {/* On a till, Cash Drawer & Invoices live here (moved off the top
                    toolbar) with the shift quick actions. On a big till screen the
                    whole block sinks to the bottom (lg:mt-auto) so it uses the
                    otherwise-empty lower half instead of crowding the categories. */}
                {tillMode && (
                  <>
                    <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Till</p>
                    <div className="mb-4 grid grid-cols-2 gap-2.5">
                      <Link
                        href="/money"
                        className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                      >
                        <Wallet size={18} className="text-brand-600" />
                        <span className="text-[12.5px] font-bold text-ink-900">Cash Management</span>
                      </Link>
                      <button
                        onClick={() => setInvoicesOpen(true)}
                        className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                      >
                        <ReceiptText size={18} className="text-violet-600" />
                        <span className="text-[12.5px] font-bold text-ink-900">Invoices</span>
                      </button>
                    </div>
                  </>
                )}
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Shift</p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <button
                    onClick={() => openShift("DROP")}
                    className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <Vault size={18} className="text-amber-500" />
                    <span className="text-[12.5px] font-bold text-ink-900">Safe Drop</span>
                  </button>
                  <button
                    onClick={() => openShift("transfer")}
                    className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <Landmark size={18} className="text-sky-600" />
                    <span className="text-[12.5px] font-bold text-ink-900">Bank Transfer</span>
                  </button>
                  <button
                    onClick={() => openShift("movements")}
                    className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <ArrowLeftRight size={18} className="text-sky-600" />
                    <span className="text-[12.5px] font-bold text-ink-900">Cash Movements</span>
                  </button>
                  <button
                    onClick={() => openShift("survey")}
                    className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <Scale size={18} className="text-brand-600" />
                    <span className="text-[12.5px] font-bold text-ink-900">Shift Survey</span>
                  </button>
                  <button
                    onClick={() => openShift("close")}
                    className="card flex flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:-translate-y-0.5 hover:ring-brand-200 hover:shadow-soft"
                  >
                    <Lock size={18} className="text-rose-500" />
                    <span className="text-[12.5px] font-bold text-ink-900">Close Shift</span>
                  </button>
                </div>

              </div>
            </div>
          )}
          </div>
        </div>

        {/* Cart — order-1 on desktop puts it on the LEFT. Sticky and full-height
            on desktop so it stays put and always shows a tall, stable panel
            (not a short card that grows/shrinks with the basket). */}
        <div className={`lg:order-1 ${tillMode ? "lg:h-full lg:min-h-0" : "lg:sticky lg:top-6 lg:self-start"}`}>
          <div className={`card flex flex-col ${tillMode ? "max-h-full lg:h-full lg:min-h-0" : "max-h-[calc(100vh-7rem)] lg:h-[calc(100vh-7rem)]"}`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-brand-600" />
                <h3 className="font-bold text-ink-900">Current Sale</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Held orders live here so the cashier can recall one even with an
                    empty cart (start of a fresh sale). */}
                {held.length > 0 && (
                  <button
                    onClick={() => setResumeOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    <PlayCircle size={13} /> Held ({num(held.length)})
                  </button>
                )}
                {lines.length > 0 && (
                  <button
                    onClick={holdOrder}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:text-brand-700"
                    title="Park this sale and serve the next customer"
                  >
                    <PauseCircle size={13} /> Hold
                  </button>
                )}
                {lines.length > 0 && (
                  <button onClick={clearCart} className="text-xs font-semibold text-slate-400 hover:text-rose-500">
                    Clear
                  </button>
                )}
              </div>
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
                    <div
                      key={lineKey(l.product, l.markdown, l.unit, l.options)}
                      data-newest={l.seq === justAdded ? "1" : undefined}
                      className={`flex items-center gap-2 rounded-xl transition-colors duration-700 ${
                        l.seq === justAdded ? "bg-brand-50 ring-2 ring-brand-200" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        {/* The packaging badge sits OUTSIDE the name: "Case" is
                            the one word the cashier must see, and it must not be
                            pushed off the end by a long product name.
                            The name itself wraps rather than truncating — the
                            cashier checks the basket against what the customer
                            handed over, and "ICE Shaken…" doesn't let them. */}
                        <p className="flex items-start gap-1.5">
                          <span className="break-words text-sm font-semibold text-ink-800">{l.product.name}</span>
                          {!l.unit.isBase && (
                            <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              {l.unit.name}
                            </span>
                          )}
                        </p>
                        {/* How this one is to be made. The cashier reads the
                            basket back to the customer, so it has to be here —
                            not only on the kitchen ticket. */}
                        {l.options?.length ? (
                          <p className="text-[11px] font-semibold text-amber-700">{optionsLabel(l.options)}</p>
                        ) : null}
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
                          onClick={() => setQty(lineKey(l.product, l.markdown, l.unit, l.options), l.qty - 1)}
                          aria-label="Decrease quantity"
                          className="grid h-8 w-8 place-items-center rounded-l-lg text-slate-600 hover:bg-slate-200 active:bg-slate-300"
                        >
                          <Minus size={15} />
                        </button>
                        <span className="w-7 text-center text-sm font-bold tabular-nums text-ink-900">{l.qty}</span>
                        <button
                          onClick={() => setQty(lineKey(l.product, l.markdown, l.unit, l.options), l.qty + 1)}
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
                        onClick={() => setQty(lineKey(l.product, l.markdown, l.unit, l.options), 0)}
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
              {/* Label left, switch RIGHT — the usual shape for a setting row,
                  and it puts the switch where the till badge used to sit rather
                  than leaving the row lopsided with everything bunched left.
                  The whole row is the tap target, which matters on a touch till.

                  (No till name here any more: it used to be an editable box that
                  let a cashier move this device onto another till's books
                  mid-shift. That control is now owner-only in the till menu, and
                  the header already says which till this is.) */}
              <button
                type="button"
                onClick={() => setWantQueue((v) => !v)}
                aria-pressed={wantQueue}
                className="flex w-full items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-left ring-1 ring-slate-200 transition hover:bg-slate-100"
              >
                <span className="text-[13px] font-semibold text-ink-800">Pickup number</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                    wantQueue ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      wantQueue ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>

              <div>
                <label className="label">Payment</label>
                {/* Real touch targets. These were 10px tall text on a ~36px
                    button — fine with a mouse, awkward with a thumb on a busy
                    counter, and picking the wrong one takes the money the wrong
                    way. Sized to be hit without looking, and the chosen one is
                    ringed so it reads at a glance from standing height. */}
                {/* Columns follow the number of methods, so removing one makes
                    the rest wider rather than leaving a hole. */}
                <div className={`grid gap-2 ${PAYMENTS.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                  {PAYMENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPayment(p)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl py-6 text-lg font-bold transition active:scale-[0.98] ${
                        payment === p
                          ? "bg-brand-600 text-white ring-2 ring-brand-300"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {p === "KHQR" && <QrCode size={17} />}
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

              {/* The scanned coupon, with a way to take it off. A cashier who
                  scans the wrong voucher must be able to undo it without
                  clearing the whole basket. */}
              {coupon && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 ring-1 ring-violet-200">
                  <Ticket size={15} className="shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-violet-900">{coupon.name}</p>
                    <p className="text-[11px] text-violet-700">
                      {coupon.detail} · {coupon.code}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-violet-800">
                    - {usd(couponOff)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCoupon(null)}
                    title="Remove this coupon"
                    className="shrink-0 rounded-lg p-1 text-violet-400 transition hover:bg-violet-100 hover:text-violet-700"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                {promoDiscount > 0 && <Row label="Promotions" value={`- ${usd(promoDiscount)}`} tone="rose" />}
                {couponOff > 0 && <Row label="Coupon" value={`- ${usd(couponOff)}`} tone="rose" />}
                {manualDiscount > 0 && <Row label="Discount" value={`- ${usd(manualDiscount)}`} tone="rose" />}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-ink-900">Total</span>
                    <span className="block text-[11px] text-slate-400">Includes VAT {Math.round(VAT_RATE * 100)}%</span>
                  </div>
                  <span className="text-right">
                    <span className="block text-lg font-bold text-brand-600">{usd(total)}</span>
                    <span className="block text-[11px] text-slate-400">{rielDue(total)}</span>
                  </span>
                </div>
              </div>

              {!tillMode ? (
                <button onClick={() => setTillGate(true)} className="btn-primary w-full py-3 text-base">
                  <MonitorCheck size={18} /> Turn on Till Mode to sell
                </button>
              ) : (
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
              )}
              {!tillMode && (
                <p className="mt-2 text-center text-xs text-slate-400">Real sales are only recorded on a locked till.</p>
              )}
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
            {!tillMode ? (
              <button onClick={() => setTillGate(true)} className="btn-primary min-w-[9rem] py-3 text-base">
                <MonitorCheck size={18} /> Till Mode
              </button>
            ) : (
              <button onClick={handleCharge} disabled={submitting} className="btn-primary min-w-[9rem] py-3 text-base">
                {payment === "KHQR" && <QrCode size={18} />}
                {submitting ? "Processing…" : payment === "KHQR" ? "Pay KHQR" : "Charge"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* KHQR payment modal */}
      {khqrOpen && (
        <KhqrModal
          amount={total}
          billNumber={khqrBill}
          storeName={storeName}
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
          onConfirm={async (tendered, split) => {
            setSubmitting(true);
            try {
              await commitSale({ tendered, tenderedUsd: split.usd, tenderedRiel: split.riel });
            } catch (e: any) {
              setToast(e.message);
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {/* Receipt modal */}
      {asking && (
        <OptionPicker
          product={asking.product}
          groups={asking.groups}
          onCancel={() => setAsking(null)}
          onPick={(chosen) => {
            const a = asking;
            setAsking(null);
            if (a) addToCart(a.product, a.markdown, a.unit, chosen);
          }}
        />
      )}

      {receipt && <ReceiptModal sale={receipt} business={business ?? undefined} onClose={() => setReceipt(null)} />}

      {resumeOpen && (
        <HeldOrdersModal
          held={held}
          onResume={resumeOrder}
          onDelete={deleteHeld}
          onClose={() => setResumeOpen(false)}
        />
      )}

      {/* Turn this device into a locked till — owner password required. */}
      {tillGate && (
        <ManagerGate
          title="Turn on Till Mode"
          hint="Lock this device to the POS screen only. Whoever signs in here afterwards sees just the sale screen. Only the owner can switch it off again."
          actionLabel="Turn on Till Mode"
          ownerOnly
          codeLabel="Owner password"
          onClose={() => setTillGate(false)}
          onOk={() => { setTillGate(false); setTillMode(true); }}
        />
      )}

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
  unit,
  onAdd,
  onToggleFavourite,
}: {
  p: Product;
  // The sale unit this tile represents. Omitted (or the base unit) = the single;
  // a pack/carton unit shows that packaging's name and price and rings it up.
  unit?: ResolvedUnit;
  onAdd: (p: Product, unit?: ResolvedUnit) => void;
  onToggleFavourite?: (p: Product) => void;
}) {
  const showPack = !!unit && !unit.isBase;
  const price = unit ? unit.price : p.price;
  return (
    // `relative` so the star can sit on top: the whole tile is one big button
    // (a cashier taps anywhere to sell), and a button can't legally nest inside
    // another, so the star is a sibling layered over it.
    <div className="group relative">
      {/* The tile grows to fit its name rather than cropping it. This shop sells
          several products whose names differ only near the END — two "ICE Shaken
          Espresso" variants, three sizes of the same drink — and a clipped name
          made them identical on screen, which is a wrong-item sale waiting to
          happen. A minimum height keeps short names tidy, and CSS grid already
          levels every tile in a row, so one long name costs a little height on
          its own row and nothing anywhere else. */}
      <button
        onClick={() => onAdd(p, unit)}
        // h-full matters: the grid stretches the WRAPPER to the tallest tile in
        // the row, but the button inside would keep its own content height, so
        // the prices sat at different heights and the row read as ragged.
        className="card flex h-full min-h-[7rem] w-full flex-col p-2 text-left transition hover:-translate-y-0.5 hover:shadow-soft"
      >
        {p.image && (
          <div className="mb-1 h-16 w-full shrink-0 overflow-hidden rounded-lg bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/product-image/${p.image}`} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )}
        {/* Name and price only — the cashier taps the tile to sell. Item code,
            stock and status stay on the Inventory screen. `pr-4` keeps the name
            clear of the favourite star in the top-right corner. */}
        {/* The name gets a reserved block three lines deep. Short names leave it
            part-empty, which is what puts every price on the same line across a
            row and stops the grid looking like scattered text. Longer names grow
            past it rather than being cut — the whole point of this change. */}
        <p className="min-h-[2.7rem] break-words pr-4 text-[11.5px] font-semibold leading-tight text-ink-800">
          {p.name}
        </p>
        {/* When a pack/carton code was matched, say so plainly — the price below
            is that whole pack, not one unit. */}
        {showPack && (
          <span className="mt-0.5 w-fit rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-600">
            {unit!.name} · {unit!.conversion} {baseUnitName(p).toLowerCase()}
          </span>
        )}
        <span className="mt-auto pt-0.5 text-[13px] font-bold text-brand-600">
          {usd(price)}
          {showPack && <span className="ml-1 text-[9px] font-semibold text-slate-400">/ {unit!.name.toLowerCase()}</span>}
        </span>
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

// Held-orders list: recall a parked sale, or drop one that's no longer needed.
function HeldOrdersModal({
  held,
  onResume,
  onDelete,
  onClose,
}: {
  held: HeldOrder<Record<string, CartLine>>[];
  onResume: (o: HeldOrder<Record<string, CartLine>>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <PauseCircle size={18} className="text-amber-500" /> Held orders
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {held.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No held orders.</p>
          ) : (
            <div className="space-y-2">
              {held.map((o) => (
                <div key={o.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                      {usd(o.total)}
                      <span className="font-normal text-slate-400">
                        · {num(o.count)} item{o.count === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock size={11} /> {dateTime(o.at)}
                    </p>
                  </div>
                  <button
                    onClick={() => onResume(o)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700"
                  >
                    <PlayCircle size={14} /> Resume
                  </button>
                  <button
                    onClick={() => onDelete(o.id)}
                    aria-label="Delete held order"
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptModal({ sale, business, onClose }: { sale: Sale; business?: ReceiptBusiness; onClose: () => void }) {
  const thermal = hasThermalPrinter();
  function printReceipt() {
    const payload = buildReceiptPayload(sale, business, {
      dateTime: invoiceDateTime(sale.createdAt),
      rielTotal: Math.round((sale.total || 0) * EXCHANGE_RATE),
      footerNote: (business as any)?.receipt?.footerNote,
    });
    // On a Sunmi (companion app) this prints on the built-in printer + pops the
    // drawer. In a plain browser there's no thermal printer, so fall back to the
    // browser's print dialog.
    if (!printThermalReceipt(payload)) window.print();
  }
  // Auto-print the moment a sale completes when a real thermal printer is there,
  // so the cashier never has to tap Print — exactly like a normal till.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (autoPrinted.current || !thermal) return;
    autoPrinted.current = true;
    printReceipt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              {localizeQueueCode(
                sale.queueCode || formatQueue(sale.queueNumber),
                (business?.queueSettings?.numberStyle as QueueNumberStyle) || "latin",
              )}
            </p>
            <p className="text-[12px] text-brand-700/80">Please wait for your number.</p>
          </div>
        )}

        {/* The receipt itself — styled from the store's Invoice Customization. */}
        <ReceiptCard sale={sale} business={business} />

        <div className="mt-4 flex gap-2">
          <button onClick={printReceipt} className="btn-ghost flex-1 justify-center">
            <Printer size={16} /> {thermal ? "Reprint" : "Print"}
          </button>
          <button onClick={onClose} className="btn-primary flex-1 justify-center">
            New Sale
          </button>
        </div>
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
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-soft lg:max-w-4xl xl:max-w-5xl">
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
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-700">Cancelling an invoice needs approval — an approver badge code (set in Store Settings) or a manager&rsquo;s own code.</p>
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
                placeholder="Approval code / badge"
                autoComplete="off"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") confirmCancel(); }}
                className="input"
              />
              <p className="mt-1.5 text-[11px] text-slate-400">Scan or type an approver badge code (Store Settings → Receipt-edit approvers), or a manager&rsquo;s own code — the system records who approved.</p>
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
  onConfirm: (tendered: number, split: { usd: number; riel: number }) => void;
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

  // Nobody hands over a hundred times the bill. An amount that large is a
  // mistake — most often a barcode scanned into this box, which is how one sale
  // recorded a $88,460,000,187,400 tender. Blocking it stops the bad figure
  // reaching the books AND tells the cashier what to do, instead of leaving the
  // till stuck on a sale that can never balance.
  const absurd = tendered > Math.max(1000, total * 100 + 100);
  const canConfirm = enough && !absurd;

  function confirm() {
    if (!canConfirm || busy) return;
    onConfirm(tendered, { usd: usdNum, riel: rielNum });
  }

  const usdChips = USD_NOTES.filter((n) => n >= total).slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      {/* Wide, not tall. A cash dialog on a touch till is read at arm's length
          while the cashier is looking at the customer's hand, so the figures and
          the note chips get real size — and the two currencies sit side by side
          rather than stacking into a column that pushes Confirm off the screen. */}
      <div className="relative z-10 max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white p-8 shadow-soft">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-bold text-ink-900">Cash payment</h3>
            <p className="text-base text-slate-500">Count what the customer gives you</p>
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

        <div className="mb-5 rounded-2xl bg-slate-50 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-semibold text-slate-500">Amount due</span>
            <span className="text-right">
              <span className="block text-4xl font-extrabold text-ink-900">{usd(total)}</span>
              <span className="block text-sm text-slate-400">{rielDue(total)}</span>
            </span>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cash-usd">
              Received — US$
            </label>
            <input
              id="cash-usd"
              ref={inputRef}
              className="input h-16 text-3xl font-bold"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={usdIn}
              onChange={(e) => setUsdIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setUsdIn(total.toFixed(2));
                  setRielIn("");
                }}
                className="rounded-xl bg-slate-100 px-5 py-3 text-base font-bold text-slate-600 hover:bg-slate-200"
              >
                Exact
              </button>
              {usdChips.map((n) => (
                <button
                  key={n}
                  onClick={() => setUsdIn(String(n))}
                  className="rounded-xl bg-slate-100 px-5 py-3 text-base font-bold text-slate-600 hover:bg-slate-200"
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
              className="input h-16 text-3xl font-bold"
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
                  className="rounded-xl bg-slate-100 px-4 py-3 text-base font-bold text-slate-600 hover:bg-slate-200"
                >
                  +{num(n)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Change / shortfall — the whole reason this screen exists */}
        <div
          className={`mt-5 rounded-2xl px-5 py-4 ${
            !touched ? "bg-slate-50" : enough ? "bg-emerald-50" : "bg-amber-50"
          }`}
        >
          {!touched ? (
            <p className="text-center text-base text-slate-400">Enter the cash received</p>
          ) : enough ? (
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-emerald-700">Change</span>
              <span className="text-right">
                <span className="block text-5xl font-extrabold text-emerald-700">{usd(change)}</span>
                <span className="block text-sm font-semibold text-emerald-600">{riel(change)}</span>
              </span>
            </div>
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-amber-700">Still short</span>
              <span className="text-right">
                <span className="block text-4xl font-extrabold text-amber-700">{usd(short)}</span>
                <span className="block text-sm font-semibold text-amber-600">{riel(short)}</span>
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

        {absurd && (
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-center text-sm font-semibold text-rose-700">
            That amount is far more than the bill — clear it and type what the customer gave you.
            <span className="mt-1 block text-xs font-medium text-rose-500">
              A scanned barcode lands here if the scanner is used while this box is open.
            </span>
          </p>
        )}
        <button onClick={confirm} disabled={!canConfirm || busy} className="btn-primary mt-5 w-full py-5 text-xl">
          {busy ? "Processing…" : canConfirm ? `Confirm · change ${usd(change)}` : "Confirm"}
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
  storeName,
  onCancel,
  onConfirmed,
}: {
  amount: number;
  billNumber: string;
  storeName: string;
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
        // Put the QR on the customer's second screen so they scan it themselves.
        publishCustomerDisplay({ kind: "khqr", storeName, amount, qrImage: d.qrImage });
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
        {/* KHQR brand band. KHQR is Cambodia's national standard, so the ONE QR
            is scannable by every bank app (ABA, Wing, Bakong, ACLEDA…) — the
            store integrates ABA but the customer can pay from any bank. */}
        <div className="flex items-center justify-between bg-[#e21a1a] px-5 py-3 text-white">
          <span className="text-lg font-black tracking-tight">KHQR</span>
          <span className="text-xs font-medium opacity-90">Scan with any Cambodian bank app</span>
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
                <p className="text-xs text-slate-400">{rielDue(amount)}</p>
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
type BasketRow = { sales: number; qty: number; revenue: number; cost: number; profit: number; avgSale: number };
type TillRow = BasketRow & { terminal: string };
type BuyerRow = BasketRow & { customerId: string; name: string };
type SalesReportData = {
  byItem: ItemRow[];
  byCategory: CatRow[];
  byTerminal: TillRow[];
  byCustomer: BuyerRow[];
  totals: { qty: number; revenue: number; cost: number; profit: number; sales: number; avgSale: number };
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
                  { label: "Sales", value: num(data.totals.sales) },
                  // What one customer spends per visit — the number an owner
                  // watches to know whether the basket is growing.
                  { label: "Average basket", value: usd(data.totals.avgSale) },
                  ...(showProfit ? [{ label: "Cost", value: usd(shown.cost) }] : []),
                  ...(showProfit ? [{ label: "Profit", value: usd(shown.profit) }] : []),
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
                    <p className="mt-1 text-lg font-bold text-ink-900">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* By till and by customer.

                  Both count whole SALES, so "average" means what one customer
                  spent on one visit — not the average price of a line. These
                  deliberately ignore the item/category filter above: a till's
                  takings are its takings, and filtering them by product would
                  produce a figure that reconciles against nothing. */}
              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                {[
                  {
                    title: "By till",
                    rows: data.byTerminal.map((t) => ({
                      key: t.terminal,
                      label: t.terminal,
                      sub: "",
                      sales: t.sales,
                      revenue: t.revenue,
                      avgSale: t.avgSale,
                    })),
                  },
                  {
                    title: "By customer",
                    rows: data.byCustomer.map((c) => ({
                      key: c.customerId || "walkin",
                      label: c.name,
                      sub: c.customerId ? "" : "no account",
                      sales: c.sales,
                      revenue: c.revenue,
                      avgSale: c.avgSale,
                    })),
                  },
                ].map((tbl) => (
                  <div key={tbl.title} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2.5">
                      <p className="text-sm font-bold text-ink-900">{tbl.title}</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          <th className="px-3.5 py-1.5 text-left">Name</th>
                          <th className="px-3 py-1.5 text-right">Sales</th>
                          <th className="px-3 py-1.5 text-right">Revenue</th>
                          <th className="px-3.5 py-1.5 text-right">Average</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tbl.rows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3.5 py-6 text-center text-xs text-slate-400">
                              Nothing in this period
                            </td>
                          </tr>
                        ) : (
                          tbl.rows.map((r) => (
                            <tr key={r.key} className="border-b border-slate-50 last:border-0">
                              <td className="px-3.5 py-2">
                                <p className="font-medium text-ink-800">{r.label}</p>
                                {r.sub && <p className="text-[11px] text-slate-400">{r.sub}</p>}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-ink-800">{num(r.sales)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{usd(r.revenue)}</td>
                              <td className="px-3.5 py-2 text-right font-semibold text-brand-700">{usd(r.avgSale)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
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

// ---------------------------------------------------------------------------
// Condiments — how a made-to-order item should be prepared.
//
// Opens when a tapped product's CATEGORY has option groups (Store Settings →
// Condiments). The cashier answers, the choice rides on the basket line, and it
// reaches the kitchen ticket. Big touch targets: this is asked mid-order with a
// customer waiting, and picking "level 6" when they said 5 sends the wrong food.
// ---------------------------------------------------------------------------
function OptionPicker({
  product,
  groups,
  onPick,
  onCancel,
}: {
  product: Product;
  groups: OptionGroup[];
  onPick: (chosen: SaleItemOption[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Every REQUIRED group must be answered. An unanswered one would reach the
  // kitchen as a dish with no instruction, which is the failure this prevents.
  const missing = groups.filter((g) => g.required !== false && !picked[g.id]);

  function confirm() {
    if (missing.length) return;
    const chosen: SaleItemOption[] = [];
    for (const g of groups) {
      const cid = picked[g.id];
      const c = g.choices.find((x) => x.id === cid);
      if (!c) continue;
      chosen.push({
        group: g.name,
        choice: c.name,
        priceDelta: c.priceDelta || undefined,
        groupId: g.id,
        choiceId: c.id,
      });
    }
    onPick(chosen);
  }

  return (
    <Modal open onClose={onCancel} title={product.name} size="md">
      <p className="mb-4 text-sm text-slate-500">How would they like it?</p>
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="mb-2 text-sm font-bold text-ink-900">
              {g.name}
              {g.required !== false && <span className="ml-1 text-rose-500">*</span>}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {g.choices.map((c) => {
                const on = picked[g.id] === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setPicked((p) => ({ ...p, [g.id]: c.id }))}
                    className={`rounded-xl px-3 py-4 text-sm font-bold transition active:scale-[0.98] ${
                      on ? "bg-brand-600 text-white ring-2 ring-brand-300" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {c.name}
                    {/* Only shown when it actually costs something, so a free
                        choice isn't cluttered with "+$0.00". */}
                    {!!c.priceDelta && (
                      <span className={`block text-[11px] font-semibold ${on ? "text-white/80" : "text-slate-500"}`}>
                        +{usd(c.priceDelta)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <button className="btn-ghost flex-1 py-3" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary flex-1 py-3 text-base" disabled={missing.length > 0} onClick={confirm}>
          {missing.length ? `Choose ${missing[0].name}` : "Add to sale"}
        </button>
      </div>
    </Modal>
  );
}
