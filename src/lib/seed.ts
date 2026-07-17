import fs from "fs";
import path from "path";
import type { DB, Product, Supplier, PurchaseRequest, PurchaseOrder } from "./types";

// ---------------------------------------------------------------------------
// Real ON Mart master data, generated from "ADD Supplier.xlsx" into
// data/master.json (products + suppliers).
// ---------------------------------------------------------------------------
type Master = { products: Product[]; suppliers: Supplier[] };

function loadMaster(): Master | null {
  try {
    const file = path.join(process.cwd(), "data", "master.json");
    const raw = fs.readFileSync(file, "utf8");
    const m = JSON.parse(raw) as Master;
    if (Array.isArray(m.products) && m.products.length) return m;
  } catch {
    /* fall through to empty */
  }
  return null;
}

// Your real PO-100020 (AUTOSHINE) recreated so the flow + PO print are live.
const AUTOSHINE_LINES: { barcode: string; name: string; uomSize: string; qty: number; cost: number }[] = [
  { barcode: "6937372025901", name: "Trikeel Hair Beauty Tools T16824", uomSize: "", qty: 10, cost: 0.5 },
  { barcode: "6937372026427", name: "Trikeel Eyebrow Tweezers TR824", uomSize: "", qty: 10, cost: 0.85 },
  { barcode: "6937372027349", name: "Trikeel Makeup Puff T078118", uomSize: "", qty: 10, cost: 0.7 },
  { barcode: "6937372027509", name: "Trikeel Hair Comb T14878", uomSize: "", qty: 10, cost: 2.0 },
  { barcode: "6937372022245", name: "Trikeel Hair Comb TR1446", uomSize: "", qty: 10, cost: 0.85 },
  { barcode: "6937372026441", name: "Trikeel Eyebrow Tweezers TR802", uomSize: "", qty: 10, cost: 0.85 },
  { barcode: "6937372029060", name: "Trikeel Hair Roller T16642", uomSize: "", qty: 10, cost: 1.8 },
  { barcode: "6936658186572", name: "Ne Zha Blind Box", uomSize: "", qty: 10, cost: 1.15 },
  { barcode: "6937372022184", name: "Trikeel Hair Comb TR1440", uomSize: "", qty: 5, cost: 1.6 },
  { barcode: "6937372022276", name: "Trikeel Hair Comb TR1449", uomSize: "", qty: 5, cost: 0.8 },
  { barcode: "6937372024393", name: "Trikeel Beauty Hair Comb TN628", uomSize: "", qty: 5, cost: 1.7 },
  { barcode: "6937372024706", name: "Trikeel Ear Cleaner TO4830", uomSize: "", qty: 5, cost: 1.1 },
  { barcode: "6937372026328", name: "Trikeel Nail Clippers Set 2s TO9807", uomSize: "", qty: 5, cost: 0.9 },
  { barcode: "6937372026601", name: "Trikeel Shower Glove T11813", uomSize: "", qty: 5, cost: 1.4 },
  { barcode: "6937372027493", name: "Trikeel Hair Comb T14877", uomSize: "", qty: 5, cost: 2.3 },
  { barcode: "6951348760542", name: "Kinepin Toenail small clipper J1054", uomSize: "", qty: 5, cost: 1.2 },
  { barcode: "3541396614206", name: "Na Zha Stickers 30pcs MY-T135", uomSize: "", qty: 5, cost: 0.7 },
  { barcode: "9555085402924", name: "Jades Scented Gel 180gm - Orange (Air Freshener Room)", uomSize: "", qty: 3, cost: 2.3 },
  { barcode: "9555085407769", name: "Jades Car Aroma Gel 90gm - Paradise (Air Freshener Car)", uomSize: "", qty: 3, cost: 1.8 },
  { barcode: "9555085407752", name: "Jades Car Aroma Gel 90gm - Peony (Air Freshener Car)", uomSize: "", qty: 3, cost: 1.8 },
  { barcode: "9555085402115", name: "Jades Deodorizer 120gm - Lavender (Mothballs / Ubat Gegat)", uomSize: "", qty: 3, cost: 1.4 },
  { barcode: "6935539618904", name: "LJP Squishy Dumplings Bun 1pcs 2483A", uomSize: "12", qty: 60, cost: 0.9 },
  { barcode: "6935539618881", name: "LJP Squishy Dumplings Bun 1pcs TK2481A", uomSize: "24", qty: 120, cost: 1.3 },
  { barcode: "6978196293657", name: "LJP JXC-0427 Squishy Steaming Pan Dumplings", uomSize: "12", qty: 36, cost: 1.3 },
  { barcode: "6956325522113", name: "LJP Sticker Decorate for kids GL5396 3s", uomSize: "12", qty: 4, cost: 0.65 },
  { barcode: "6975276065046", name: "LJP Sticker Decorate for kids QA/CSG01-2020 100s", uomSize: "12", qty: 3, cost: 1.9 },
];

export function buildSeed(opts?: { storeName?: string; withDemo?: boolean }): DB {
  // The default store keeps the ON Mart demo (AUTOSHINE PO + audit trail);
  // every other store starts with the product master but no orders/history.
  const withDemo = opts?.withDemo !== false;
  const master = loadMaster();
  const products: Product[] = master?.products ?? [];
  const suppliers: Supplier[] = master?.suppliers ?? [];
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]));

  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  // --- Seed the real AUTOSHINE order: PR-100001 → PO-100020 ------------------
  const purchaseRequests: PurchaseRequest[] = [];
  const purchaseOrders: PurchaseOrder[] = [];

  if (products.length && withDemo) {
    const prItems = AUTOSHINE_LINES.map((l) => {
      const p = byBarcode.get(l.barcode);
      return {
        productId: p?.id ?? `ext-${l.barcode}`,
        sku: p?.sku ?? "",
        name: l.name,
        supplier: "AUTOSHINE",
        unit: p?.unit ?? "U",
        qty: l.qty,
        cost: l.cost,
        barcode: l.barcode,
      };
    });

    purchaseRequests.push({
      id: "pr100001",
      prNo: "PR-100001",
      status: "Converted",
      requestedBy: "Store L3",
      note: "AUTOSHINE beauty & toys re-order.",
      items: prItems,
      createdAt: daysAgo(2),
      decidedAt: daysAgo(2),
      poIds: ["po100020"],
    });

    purchaseOrders.push({
      id: "po100020",
      poNo: "PO-100020",
      prId: "pr100001",
      prNo: "PR-100001",
      supplier: "AUTOSHINE",
      status: "Open",
      expectedDate: "2026-06-26T00:00:00.000Z",
      createdAt: "2026-06-25T00:00:00.000Z",
      items: AUTOSHINE_LINES.map((l) => {
        const p = byBarcode.get(l.barcode);
        return {
          productId: p?.id ?? `ext-${l.barcode}`,
          sku: p?.sku ?? "",
          // A placed PO is a historical snapshot: keep the item name and cost
          // exactly as they appeared on the original document, even if the
          // live catalog entry is later renamed or repriced.
          name: l.name,
          unit: p?.unit ?? "U",
          qtyOrdered: l.qty,
          qtyReceived: 0,
          cost: l.cost,
          barcode: l.barcode,
          uomSize: l.uomSize || undefined,
        };
      }),
    });
  }

  // Seed a short audit trail for the demo PR/PO so the log isn't empty.
  const auditLog = products.length && withDemo
    ? [
        {
          id: "a1",
          at: daysAgo(2),
          actor: "Store L3",
          action: "Submitted",
          entityType: "PR" as const,
          entity: "PR-100001",
          detail: "AUTOSHINE beauty & toys re-order · 26 items",
        },
        {
          id: "a2",
          at: daysAgo(2),
          actor: "Procurement",
          action: "Approved",
          entityType: "PR" as const,
          entity: "PR-100001",
        },
        {
          id: "a3",
          at: "2026-06-25T00:00:00.000Z",
          actor: "Procurement",
          action: "Created",
          entityType: "PO" as const,
          entity: "PO-100020",
          detail: "AUTOSHINE · 26 items · $432.50",
        },
      ]
    : [];

  const business = withDemo
    ? {
        name: "Stookii",
        currency: "USD",
        exchangeRate: 4100,
        vatRate: 0.1,
        address: "St. 592, Sangkat Boeng Kak 2, Khan Toul Kork, Phnom Penh, Cambodia",
        phone: "099 423 599",
        branch: "ON Mart PP – Tuol Kork (Street 592)",
        shipTo: "St. 592, Sangkat Boeng Kak 2, Khan Toul Kork, Phnom Penh, Cambodia",
        receivedBy: "0964155086 (Linda)  •  099423599 (Mengly)  •  0969493924 (Chan)",
        authorizedBy: "Sorn Koemseng",
        invoiceTo: [
          "Please issue invoice to: អតិថិជន / Customer : អង្គរ ប្រូថឹថាយ (On Mart St.592 TK)",
          "អាសយដ្ឋាន: ផ្ទះ ៥៩២ កែងបណ្តោយ ៦ សង្កាត់បឹងកក់ទី២ ខណ្ឌទួលគោក ភ្នំពេញ",
          "លេខទំនាក់ទំនង: 099 423 599   លេខអត្តសញ្ញាណកម្ម អតប (VAT): L001-901503056",
        ],
        poNotes: [
          "1. Payment Term: As per agreement",
          "2. Delivery Term: As per agreement",
          "3. Prices are EX VAT; VAT 10% added separately",
        ],
        approvers: [
          { role: "Manager", name: "", code: "1234" },
          { role: "Assistant Manager", name: "", code: "5678" },
        ],
      }
    : {
        // Clean profile for a newly created store — the owner fills these in
        // via Settings; sensible Cambodia defaults to start.
        name: "Stookii",
        currency: "USD",
        exchangeRate: 4100,
        vatRate: 0.1,
        address: "",
        phone: "",
        branch: opts?.storeName || "New Store",
        shipTo: "",
        receivedBy: "",
        authorizedBy: "",
        invoiceTo: [],
        poNotes: [
          "1. Payment Term: As per agreement",
          "2. Delivery Term: As per agreement",
          "3. Prices are EX VAT; VAT 10% added separately",
        ],
        approvers: [
          { role: "Manager", name: "", code: "1234" },
          { role: "Assistant Manager", name: "", code: "5678" },
        ],
      };

  return {
    products,
    suppliers,
    customers: [],
    sales: [],
    purchaseRequests,
    purchaseOrders,
    goodsReceipts: [],
    stockCounts: [],
    writeOffs: [],
    markdowns: [],
    recipes: [],
    stockMovements: [],
    ledger: [],
    historicalPurchases: [],
    promotions: [],
    promotionUsages: [],
    auditLog,
    meta: {
      nextInvoice: 100001,
      nextPR: 100002,
      nextPO: 100021,
      nextGRN: 100001,
      nextStockCount: 100001,
      nextMarkdown: 1,
      nextRecipe: 100001,
      nextMovement: 1,
      nextLedger: 1,
      nextHistorical: 1,
      nextPromotion: 100001,
      nextPromotionUsage: 1,
      nextWriteOff: 100001,
      nextAudit: withDemo ? 4 : 1,
      business,
    },
  };
}
