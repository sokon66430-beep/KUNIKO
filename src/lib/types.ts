export type Product = {
  id: string;
  sku: string; // the "Item ID" shown in the UI (8-digit code)
  subGroupCode?: string; // codes the Item ID is generated from
  catCode?: string;
  name: string;
  nameKh?: string; // Khmer product name (printed on price labels)
  ranking?: "A" | "B" | "C" | "D"; // product ranking (printed on price labels)
  shelfLifeDays?: number; // shelf life in days (printed on price labels as S<days>D)
  groupCode?: string; // product group, e.g. A01 RTE Food … A05 Non-food (printed on price labels)
  category: string;
  supplier: string;
  supplierCode?: string;
  unit: string;
  cost: number; // USD cost price per unit (EX VAT)
  price: number; // USD sell price per unit
  stock: number; // units on hand
  reorderLevel: number;
  barcode?: string; // the PRIMARY code — what price labels print, what a PO line snapshots
  // Other codes the same product answers to (packaging changed, two plants, or
  // the POS export recorded two). Never printed, always scanned — see
  // lib/barcodes, which is the only place that knows a product has several.
  altBarcodes?: string[];
  trackStock?: boolean;
  // Show this product on the POS screen for the cashier to TAP (fresh food,
  // made-to-order drinks…). Unset = fall back to the default POS categories —
  // see lib/pos.ts. Everything else is sold by scanning its barcode.
  showOnPos?: boolean;
  // Pinned to the front of the till so the things that sell all day are one tap
  // away instead of a category drill-down.
  //
  // Deliberately NOT a master field (see lib/master MASTER_FIELDS): what sells
  // hardest differs shop to shop, so each store keeps its own favourites and a
  // master sync leaves them alone.
  favourite?: boolean;
  // Product photo shown on the POS tile — the stored file name, served by
  // /api/product-image/<name>. Set in Master Data (nothing to do with the
  // supplier-invoice photos).
  image?: string;
  gondola?: string; // PRIMARY gondola (most recently set) — printed on the label
  shelf?: string; // primary shelf position within the gondola
  // A product can sit in several places; every registered spot is kept here so
  // the stock count sheet lists them all. `gondola`/`shelf` mirror the latest.
  locations?: ProductLocation[];

  // --- Recipes -------------------------------------------------------------
  // Set on a SELLABLE product that is made to order (Spicy Noodle Beef). When
  // it sells, the linked recipe's ingredients come off stock instead of this
  // product's own count — see lib/recipes.ts.
  recipeId?: string;
  // Set on an INGREDIENT bought in one unit and consumed in another. `unit`
  // stays what stock is counted in (the purchase unit, e.g. kg); this is what
  // recipes are written in (e.g. g). Display only — conversion works off the
  // units themselves, so this is a default for the recipe form, not a rule.
  consumptionUnit?: string;
  // How many pieces are in one pack / one box, for recipe conversion. Selling
  // units (below) take precedence when set — see lib/sellingUnits packSizesOf,
  // which exists so a "Pack" can't mean 6 at the till and 10 in a recipe.
  packSize?: number;
  boxSize?: number;

  // --- Selling units -------------------------------------------------------
  // The packagings ABOVE the base unit that this product can be sold in — a
  // 6-pack, a case. The base level is deliberately NOT in here: it IS this
  // product (`unit`/`price`/`barcode`/`stock`), and copying it into a row would
  // give the price two homes to drift between. See lib/sellingUnits.
  sellingUnits?: SellingUnit[];
};

// One packaging level above the base unit. `conversion` is how many base units
// it holds — the only number that touches stock. Everything else is about how
// the scan is priced and labelled.
export type SellingUnit = {
  id: string;
  name: string; // "Pack", "Case", "Carton"
  conversion: number; // base units in one of these — always 2 or more
  price: number; // USD for one of these (NOT per base unit)
  barcode?: string; // its own barcode; scanning it sells this level
  isDefault?: boolean; // what tapping the product at the till sells
  active?: boolean; // undefined = active
};

export type ProductLocation = { gondola: string; shelf: string };

export type Supplier = {
  code: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  minOrderAmount?: number;
  leadTime?: number;
  deliverySchedule?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  taxPct?: number;
};

export type CustomerTier = "Bronze" | "Silver" | "Gold";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  loyaltyPoints: number;
  totalSpent: number;
  visits: number;
  tier: CustomerTier;
  createdAt: string;
  lastVisit?: string;
};

export type SaleItem = {
  productId: string;
  sku: string;
  name: string;
  // ALWAYS in base units — 2 cases of 24 is qty 48. One meaning of "quantity"
  // across stock, costing, promotions, recipes and every report; the packaging
  // it was sold in is recorded below rather than changing what qty counts.
  qty: number;
  price: number; // sell price PER BASE UNIT at time of sale (markdown price when discounted)
  cost: number; // unit cost at time of sale

  // --- How it was sold (see lib/sellingUnits) ------------------------------
  // Set when the line was rung up on a packaging bigger than the base unit.
  // `price` above is already this packaging's price divided down, so the money
  // works with no special case; these say what the customer actually handed
  // over so the receipt can read "2 × Case" instead of "48 × $0.4375".
  unitId?: string;
  unitName?: string; // "Case"
  unitQty?: number; // 2 — how many cases
  unitPrice?: number; // 10.50 — the price of ONE case
  conversion?: number; // 24 — base units per case
  // Set when the line was rung up from a markdown label rather than the shelf
  // barcode. `price` above is already the discounted one — these record what it
  // was discounted FROM, so reports can separate promo sales from full price.
  markdownCode?: string;
  markdownPercent?: number;
  fullPrice?: number;
  // Set when this line was made to order from a recipe. `cost` above is then the
  // recipe's ingredient cost, not the product's own cost field. Snapshotted so a
  // later re-link doesn't rewrite what history says was cooked.
  recipeId?: string;
  recipeName?: string;
};

// A temporary price cut on ONE product, sold under its own generated barcode.
// The label is stuck on the physical items being cleared (near-expiry stock,
// slow movers), so the rest of the shelf keeps selling at full price. It stops
// scanning at the till the day after `endDate` — nothing to switch off by hand.
export type Markdown = {
  id: string;
  code: string; // the generated promo barcode printed on the label
  productId: string;
  sku: string;
  name: string;
  nameKh?: string;
  category?: string;
  productBarcode?: string; // the item's normal shelf barcode, for reference
  originalPrice: number; // price at the time the markdown was registered
  percent: number; // 30 / 50 / 70 …
  price: number; // what the customer pays under this label
  startDate: string; // yyyy-mm-dd, first selling day (store timezone)
  endDate: string; // yyyy-mm-dd, LAST selling day — expires the day after
  createdAt: string;
  createdBy?: string;
  cancelledAt?: string; // pulled early; kept (not deleted) so past sales resolve
  cancelledBy?: string;
};

// ---------------------------------------------------------------------------
// Recipes — what a made-to-order product is built from
//
// A recipe turns one sale of "Spicy Noodle Beef" into the ingredients it
// actually consumed, so the cook sells a bowl and the noodles, beef and soup
// base come off stock by themselves. See lib/recipes.ts for the rules.
// ---------------------------------------------------------------------------

// One ingredient line. The ingredient IS an ordinary product — that's what
// makes its stock, cost and purchasing work with no special cases. Only the
// product ID is authoritative: sku/name are a copy kept for display so the
// recipe list doesn't need the whole catalog, and are refreshed on save.
export type RecipeItem = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string; // the unit the COOK uses (g, ml, pcs…), converted at deduction
};

export type RecipeStatus = "Active" | "Inactive";

export type Recipe = {
  id: string;
  code: string; // RCP-100001
  name: string;
  nameKh?: string;
  description?: string;
  image?: string; // stored file name, served by /api/product-image/<name>
  status: RecipeStatus; // Inactive = kept on file but never deducted
  items: RecipeItem[];
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Stock movements — an audit trail of stock leaving for a reason other than a
// direct sale of the item itself. Today that's recipe consumption; the shape is
// deliberately open so batch production can post to the same ledger later.
// ---------------------------------------------------------------------------
export type StockMovementType = "Recipe Consumption";

export type StockMovement = {
  id: string;
  type: StockMovementType;
  at: string; // ISO — date + time
  actor: string; // who rang up the sale

  // What was sold that caused this
  saleId?: string;
  invoiceNo?: string;
  recipeId?: string;
  recipeName?: string;
  soldProductId?: string;
  soldProductName?: string;
  soldQty?: number;

  // The ingredient that moved
  productId: string;
  sku: string;
  name: string;
  qtyUsed: number; // as the recipe writes it, e.g. 400
  unit: string; // …in this unit, e.g. "g"
  qtyDeducted: number; // what actually left stock, e.g. 0.4
  stockUnit: string; // …in the product's own unit, e.g. "kg"
  stockAfter: number; // on-hand after this movement (may be negative)
  cost?: number; // value consumed (USD) at the time
};

// ---------------------------------------------------------------------------
// Promotions — the multi-buy deals the till works out by itself
//
// Different animal from a Markdown: a markdown is a label stuck on specific
// physical items being cleared, sold under its own barcode. A promotion is a
// RULE over the basket ("buy 2 get 1 free", "any 3 drinks for $5") that the
// cashier never touches — they scan, and the engine decides. See lib/promotions.
// ---------------------------------------------------------------------------

export type PromotionType =
  | "BUY_X_GET_Y_FREE" // buy 2 get 1 free
  | "BUY_X_AMOUNT_OFF" // buy 2, take $1 off
  | "BUY_X_PERCENT_OFF" // buy 3, 10% off
  | "BUNDLE_PRICE"; // any 3 drinks for $5

// What the deal covers. One product, a hand-picked set, whole categories, or a
// supplier's whole range (the master has no "brand" field — the supplier is the
// closest real thing, and for "all Pepsi products" it's the same set).
export type PromotionScope =
  | { kind: "products"; productIds: string[] }
  | { kind: "category"; categories: string[] }
  | { kind: "supplier"; supplierCodes: string[] };

export type PromotionStatus = "Active" | "Paused";

export type Promotion = {
  id: string;
  code: string; // PRM-100001
  name: string;
  type: PromotionType;
  scope: PromotionScope;

  buyQty: number; // the X in every type — the qualifying quantity
  freeQty?: number; // BUY_X_GET_Y_FREE only
  discountAmount?: number; // BUY_X_AMOUNT_OFF only (USD off per set)
  discountPercent?: number; // BUY_X_PERCENT_OFF only
  bundlePrice?: number; // BUNDLE_PRICE only (what the set costs instead)

  startDate: string; // yyyy-mm-dd, first day
  endDate: string; // yyyy-mm-dd, LAST day — over the day after
  startTime?: string; // "HH:MM" daily window; both blank = all day
  endTime?: string;

  status: PromotionStatus;
  priority: number; // 1–100, highest wins when two deals want the same item

  // Which shops run this deal. Undefined or empty = ALL stores, which is both
  // the default and what every promotion written before this field meant — so
  // old records read correctly without a migration.
  //
  // Enforced by NOT mirroring the deal into a store it doesn't name (see
  // propagatePromotionsToStores): the till only ever holds deals that apply to
  // it, so nothing at the counter has to know stores exist.
  storeIds?: string[];

  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
};

// One deal firing on one sale. A ledger row per usage rather than a figure
// derived from sales: the reports need to know which items were given away and
// what the discount cost, and re-deriving that later would mean re-running the
// engine against promotions that may since have been edited.
export type PromotionUsage = {
  id: string;
  at: string;
  saleId: string;
  invoiceNo: string;
  cashier: string;

  promotionId: string;
  promotionCode: string;
  promotionName: string;
  type: PromotionType;
  detail: string; // "Buy 2 Get 1 Free"

  discount: number; // USD taken off this sale by this deal
  freeQty: number; // items handed over unpaid
  qty: number; // qualifying items the deal consumed
  revenue: number; // what the customer still paid for those items
  items: { productId: string; sku: string; name: string; qty: number; freeQty: number }[];
};

// How deals are allowed to interact. Both off by default: a customer getting a
// third bottle free AND 10% off the other two is a margin decision, not a
// default.
export type PromotionSettings = {
  // Let a second promotion consume items a first one already used.
  allowCombine: boolean;
  // Let promotions apply on top of a marked-down (already reduced) price.
  allowStackWithMarkdown: boolean;
};

export type PaymentMethod = "Cash" | "KHQR" | "Card" | "ABA" | "Wing";

export type Sale = {
  id: string;
  invoiceNo: string;
  items: SaleItem[];
  customerId?: string | null;
  customerName?: string;
  subtotal: number;
  discount: number; // every discount off the gross — promotions included
  tax: number;
  total: number;
  cost: number; // total cost of goods sold
  profit: number;
  // The deals the engine fired on this basket, for the receipt and a reprint.
  // The reporting source is db.promotionUsages — this is the customer-facing
  // summary of the same event, written in the same transaction.
  promotions?: { code: string; name: string; detail: string; discount: number; freeQty: number }[];
  paymentMethod: PaymentMethod;
  paymentRef?: string; // e.g. KHQR md5 of the confirmed Bakong transaction
  // Cash sales only: what the customer handed over and what went back to them.
  // Both in USD — riel tendered is converted at the till's rate before it lands
  // here, so the books stay in one currency.
  tendered?: number;
  change?: number;
  createdAt: string;
  imported?: boolean; // true when brought in from a sales-history import (no stock change)
  // For imported day-sales: the source invoice numbers (from the report's Invoice
  // column) that make up this day. Lets a later import skip only the transactions
  // already on record — e.g. a night shift's after-midnight invoices — instead of
  // rejecting the whole overlapping day.
  sourceInvoices?: string[];
};

// ---------------------------------------------------------------------------
// Procurement: Purchase Request → Purchase Order → Goods Receiving → Stock
// ---------------------------------------------------------------------------

export type PRStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "Cancelled" | "Converted";
export type POStatus = "Open" | "Partial" | "Received" | "Cancelled";

export type PRItem = {
  productId: string;
  sku: string;
  name: string;
  supplier: string;
  unit: string;
  qty: number;
  cost: number; // estimated unit cost (USD)
  barcode?: string;
};

export type PurchaseRequest = {
  id: string;
  prNo: string;
  status: PRStatus;
  items: PRItem[];
  note?: string;
  requestedBy: string;
  createdAt: string;
  decidedAt?: string; // when approved/rejected
  poIds: string[]; // POs generated from this PR
};

export type POItem = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  cost: number; // unit cost (USD, EX VAT)
  barcode?: string;
  uomSize?: string; // units per box, e.g. "12" (blank/"-" for loose units)
};

export type PurchaseOrder = {
  id: string;
  poNo: string;
  prId?: string;
  prNo?: string;
  supplier: string;
  status: POStatus;
  items: POItem[];
  note?: string;
  expectedDate?: string;
  createdAt: string;
  sentToSupplier?: boolean; // ticked once the team has actually sent it out
};

export type GRNItem = {
  productId: string;
  sku: string;
  name: string;
  qtyOrdered: number;
  // What ACTUALLY came off the truck — can exceed qtyOrdered when a supplier
  // over-delivers. Never capped to the order: see the receive route.
  qtyReceived: number;
  // Unit cost at the moment of receipt. A frozen snapshot, like a PO line's —
  // a receipt is a historical document and must not re-price itself when the
  // product's cost changes later. Absent on receipts made before this existed;
  // those fall back to the product's current cost.
  cost?: number;
};

export type GRNStatus = "Posted" | "PendingApproval";

// Supplier invoice photographed at receiving time, reviewed by Accounting.
export type InvoiceStatus = "Pending" | "Approved" | "Rejected";
export type InvoiceReview = {
  image: string; // FIRST page's stored file name (kept for back-compat/thumbnail)
  images?: string[]; // every page's file name (page 1 === image). Absent = 1 page.
  uploadedBy: string;
  status: InvoiceStatus;
  reviewedBy?: string;
  reviewNote?: string; // reason when rejected (optional)
  reviewedAt?: string;
};

// A proposed change to an already-submitted receipt, waiting for a manager to
// approve before it touches stock.
export type GRNPendingEdit = {
  items: { productId: string; qtyReceived: number }[]; // the corrected received qty per line
  requestedBy: string;
  requestedAt: string;
  note?: string;
};

export type GoodsReceipt = {
  id: string;
  grnNo: string;
  poId: string;
  poNo: string;
  supplier: string;
  items: GRNItem[];
  note?: string;
  receivedBy: string;
  createdAt: string;
  status?: GRNStatus; // undefined = "Posted" (legacy receipts)
  pendingEdit?: GRNPendingEdit;
  invoice?: InvoiceReview; // supplier invoice scanned at receiving (required for new receipts)
};

// An approver identity — a role + a secret code (barcode/PIN) that authorises
// changes to submitted receipts.
export type Approver = {
  role: string; // e.g. "Manager", "Assistant Manager"
  name?: string;
  code: string; // scanned/typed to approve
};

// ---------------------------------------------------------------------------
// Stock Count (stocktake) — an accountant counts products on-site; the app
// compares to system stock (variance) and adjusts once posted.
// ---------------------------------------------------------------------------
// The three physical places a product can be counted in.
export type CountPlace = "Store" | "Stock" | "Vault";
export const COUNT_PLACES: CountPlace[] = ["Store", "Stock", "Vault"];

export type StockCountItem = {
  productId: string;
  sku: string;
  name: string;
  barcode?: string;
  systemQty: number; // stock recorded at the moment the item was counted
  countedQty: number; // total counted across all places
  placeQty?: Partial<Record<CountPlace, number>>; // how much was counted in each place
  countedBy?: string; // which user counted this line
  countedAt?: string;
};

export type StockCountStatus = "Open" | "Posted";

export type StockCount = {
  id: string;
  countNo: string; // SC-100001
  status: StockCountStatus;
  countedBy: string; // the accountant / counter
  note?: string;
  items: StockCountItem[];
  createdAt: string;
  postedAt?: string;
};

// ---------------------------------------------------------------------------
// Write-Off (damaged / expired / missing / unsellable stock removed from sale)
// ---------------------------------------------------------------------------
export type WriteOffUnitType = "unit" | "weight" | "volume";

export const WRITE_OFF_REASONS = [
  "Expired",
  "Damaged",
  "Broken",
  "Missing",
  "Quality Issue",
  "Supplier Return",
  "Internal Use",
  "Other",
] as const;

export type WriteOffStatus = "Active" | "PendingCancel" | "Cancelled";

export type WriteOff = {
  id: string;
  woNo: string; // WO-100001
  productId: string;
  sku: string;
  barcode?: string;
  productName: string;
  category: string;
  quantity: number;
  unit: string; // e.g. "pcs", "kg", "L"
  unitType: WriteOffUnitType;
  cost: number; // unit cost at write-off time (for value reporting)
  reason: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  // Cancelling needs a manager's approval; the record stays for auditing.
  status?: WriteOffStatus; // undefined = "Active"
  cancelRequestedBy?: string;
  cancelRequestedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
};

export type AuditEntityType =
  | "PR"
  | "PO"
  | "GRN"
  | "Product"
  | "Supplier"
  | "Stock"
  | "Count"
  | "WriteOff"
  | "Sale"
  | "Markdown"
  | "Recipe"
  | "Promotion";

export type AuditEvent = {
  id: string;
  at: string; // ISO timestamp
  actor: string; // who did it (no auth system — role/desk name)
  action: string; // e.g. "Submitted", "Approved", "Created", "Received"
  entityType: AuditEntityType;
  entity: string; // human ref, e.g. "PR-100002", "PO-20260708-01"
  detail?: string; // one-line human summary
};

export type DB = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  markdowns: Markdown[];
  suppliers: Supplier[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  stockCounts: StockCount[];
  writeOffs: WriteOff[];
  recipes: Recipe[];
  stockMovements: StockMovement[];
  promotions: Promotion[];
  promotionUsages: PromotionUsage[];
  auditLog: AuditEvent[];
  meta: {
    nextInvoice: number;
    nextPR: number;
    nextPO: number;
    nextGRN: number;
    nextStockCount: number;
    nextWriteOff: number;
    nextMarkdown: number;
    nextRecipe: number;
    nextMovement: number;
    nextPromotion: number;
    nextPromotionUsage: number;
    nextAudit: number;
    // One-time flag: suppliers have all been defaulted to 10% VAT (after which
    // each supplier's tax rate is managed individually). See backfill().
    supplierTaxInitialized?: boolean;
    // One-time flag: multi-code products imported as "A,B" in one field have
    // been split into barcode + altBarcodes. See backfill() and lib/barcodes.
    barcodesSplit?: boolean;
    business: {
      name: string;
      currency: string;
      exchangeRate: number; // KHR per 1 USD
      vatRate: number; // e.g. 0.10
      address: string;
      phone: string;
      logo?: string; // data-URL logo printed top-left on the PO
      // Purchase-order header defaults (match the ON Mart PO format)
      branch: string;
      shipTo: string;
      receivedBy: string;
      authorizedBy: string;
      invoiceTo: string[]; // Khmer/English invoice-to note lines
      poNotes: string[]; // standing notes printed on every PO
      approvers?: Approver[]; // who may approve edits to submitted receipts
      promotionSettings?: PromotionSettings; // how deals may interact (see lib/promotions)
    };
  };
};
