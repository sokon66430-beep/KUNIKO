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
  barcode?: string;
  trackStock?: boolean;
  // Show this product on the POS screen for the cashier to TAP (fresh food,
  // made-to-order drinks…). Unset = fall back to the default POS categories —
  // see lib/pos.ts. Everything else is sold by scanning its barcode.
  showOnPos?: boolean;
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
  // How many pieces are in one pack / one box. Needed before a recipe (or a
  // future pack/case sale) can convert "1 pack" into pieces.
  packSize?: number;
  boxSize?: number;
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
  qty: number;
  price: number; // unit sell price at time of sale (the markdown price when discounted)
  cost: number; // unit cost at time of sale
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

export type PaymentMethod = "Cash" | "KHQR" | "Card" | "ABA" | "Wing";

export type Sale = {
  id: string;
  invoiceNo: string;
  items: SaleItem[];
  customerId?: string | null;
  customerName?: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cost: number; // total cost of goods sold
  profit: number;
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
  qtyReceived: number;
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
  | "Recipe";

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
    nextAudit: number;
    // One-time flag: suppliers have all been defaulted to 10% VAT (after which
    // each supplier's tax rate is managed individually). See backfill().
    supplierTaxInitialized?: boolean;
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
    };
  };
};
