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
  // What ONE stock unit of this product CONTAINS, in weight or volume — a
  // 1000 g beef pack is pieceSize 1000, pieceSizeUnit "g". This is the bridge
  // that lets a recipe written in g/kg/ml/L come off a stock counted in
  // pieces: 45 g of that pack deducts 0.045 units. Unset = no bridge.
  pieceSize?: number;
  pieceSizeUnit?: string;

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
  // Its own 8-digit product code (Item ID). Shares the first 4 digits with the
  // base product (sub-group + category), with a system-generated 4-digit tail
  // that's unique across every product AND packaging code. Assigned on save; see
  // packagingItemId in lib/itemId and validateSellingUnits in lib/sellingUnits.
  sku?: string;
  conversion: number; // base units in one of these — always 2 or more
  price: number; // USD for one of these (NOT per base unit)
  cost?: number; // buy cost for one of these (a case may be cheaper than 24× a single)
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
// ---------------------------------------------------------------------------
// Inventory ledger
//
// The permanent record of every stock movement: what moved, why, and the
// balance after. Stock is still HELD on the product (product.stock — every
// screen reads it), but it is only ever CHANGED through postLedger() in
// lib/ledger.ts, which writes the entry and the new balance in one move. A
// stock figure with no ledger line explaining it is a bug.
//
// Types with inventory impact — each one moves stock when it's written:
//   OPENING_BALANCE  the audit team's first physical count (migration start)
//   RECEIVING        goods in from a supplier (GRN)
//   SALE             rung up on this app's own POS
//   SALES_IMPORT     the external POS's daily report
//   STOCK_ADJUSTMENT a stock count's variance, or a manual restock/correction
//   WRITE_OFF        damaged / expired / lost (and its cancellation, reversed)
//
// HISTORICAL_PURCHASE deliberately does NOT exist here: old Stock-In reports
// are purchase history for analysis only and live in db.historicalPurchases,
// where they cannot touch stock by construction.
// ---------------------------------------------------------------------------
export type LedgerEntryType =
  | "OPENING_BALANCE"
  | "RECEIVING"
  | "SALE"
  | "SALES_IMPORT"
  | "STOCK_ADJUSTMENT"
  | "WRITE_OFF";

export type LedgerEntry = {
  id: string; // LG-000001
  at: string; // ISO date + time
  type: LedgerEntryType;
  productId: string;
  sku: string;
  name: string;
  barcode?: string;
  qty: number; // signed: +in / −out
  balance: number; // product.stock AFTER this entry
  ref?: string; // the document behind it: GRN no, count no, file name, invoice…
  by: string; // who caused it
  note?: string;
};

// Old supplier purchase history imported from the pre-Stookii "Stock In
// Report". Reporting/analysis ONLY — by design there is no code path from
// these rows to product.stock (see the ledger note above).
export type HistoricalPurchase = {
  id: string;
  productId?: string; // linked when the barcode/code matched the master
  barcode?: string;
  sku?: string;
  name: string;
  supplier?: string;
  qty: number;
  cost?: number; // unit cost if the report carried one
  date?: string; // yyyy-mm-dd if the report carried one
  importedAt: string;
  file: string;
};

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

// Invoice Customization — how the owner styles the customer receipt. All
// optional; sensible defaults apply when unset.
export type ReceiptAccent = "brand" | "emerald" | "violet" | "amber" | "rose" | "ink";
export type ReceiptSettings = {
  headerNote?: string; // a welcome line under the store name
  footerNote?: string; // a thank-you line at the very bottom
  showLogo?: boolean; // print the store logo on top
  showVat?: boolean; // show the ex-VAT subtotal + VAT breakdown (default on)
  showPickup?: boolean; // repeat the pickup number on the receipt (default on)
  accent?: ReceiptAccent; // colour for the store name + total ("their style")
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
  // The NET cash this sale added to the till, kept per currency so the drawer can
  // report real dollars and real riel separately (change is given in dollars, so
  // riel notes stay and the dollar part absorbs the change). cashUsd can be
  // negative when a customer pays mostly riel and takes dollar change.
  cashUsd?: number; // net US$ into the drawer
  cashRiel?: number; // net riel (face value) into the drawer
  createdAt: string;
  // Customer pickup (queue) number, when the cashier asked for one at checkout.
  // Purely for calling the customer — separate from invoiceNo/id, which stay the
  // unique transaction identifiers. queueNumber cycles 1..99; queueTicketId ties
  // back to the QueueTicket record.
  queueNumber?: number;
  queueTicketId?: string;
  // Money management: the till this sale rang up on, and the open cash shift it
  // belongs to (stamped server-side from the terminal's open shift). Both
  // optional so a sale never fails just because no shift is open — see the sales
  // route. Cash sales for a shift's drawer are the ones carrying its shiftId.
  posTerminalId?: string;
  shiftId?: string;
  // A voided invoice. The sale row is KEPT for the audit trail but excluded from
  // revenue, the drawer and reports; the stock it moved is put back and any
  // loyalty it earned is reversed. See /api/sales/[id]/cancel.
  cancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  imported?: boolean; // true when brought in from a sales-history import (no stock change)
  // For imported day-sales: the source invoice numbers (from the report's Invoice
  // column) that make up this day. Lets a later import skip only the transactions
  // already on record — e.g. a night shift's after-midnight invoices — instead of
  // rejecting the whole overlapping day.
  sourceInvoices?: string[];
};

// ---------------------------------------------------------------------------
// Queue numbers: a centralized customer-pickup ticket per store.
//
// One counter per store (db.meta.queue), shared by every POS terminal — the
// number is issued by the server inside the sale transaction, so 2–4 tills can
// never hand out the same one. Display is 3 digits (001..099) and the counter
// wraps back to 001 after 099. This is ONLY for calling the customer; the
// receipt number and transaction id stay separate and unique.
// ---------------------------------------------------------------------------
export type QueueStatus = "waiting" | "cancelled";

export type QueueTicket = {
  id: string; // Q-000001 — internal unique id (distinct from the queue number)
  number: number; // 1..99, shown zero-padded to 3 digits
  saleId: string;
  receiptNo: string; // the sale's invoiceNo
  posTerminalId?: string; // which till issued it
  cashier: string; // who took the payment
  status: QueueStatus;
  createdAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

// ---------------------------------------------------------------------------
// Money management: cash shifts and drawer control.
//
// Every money record links Store (the store file) · POS terminal · Shift ·
// Cashier · Timestamp, so accountability is complete. A shift is a cashier's
// session on one till: opened with a counted float, it accrues cash sales and
// manual movements (in / out / drop / refund), and is closed by counting the
// drawer against the expected figure. Once a supervisor approves the close the
// shift is LOCKED — no edit, no delete — until a manager reopens it (audited).
// ---------------------------------------------------------------------------
export type ShiftName = "A" | "B" | "C";
export type ShiftStatus = "open" | "pending_close" | "closed";

// A counted stack of cash: how many of each note/coin denomination. `coins` is a
// single lump for loose change under $1, so the count stays quick at the till.
export type CashCount = {
  denoms: { denom: number; count: number }[]; // USD notes, e.g. [{denom:100,count:2}, …]
  coins?: number; // total value of loose USD coins, in dollars
  riel?: { denom: number; count: number }[]; // KHR notes; converted to USD at the store rate
};

export type Shift = {
  id: string; // SH-000001
  posTerminalId: string;
  shift: ShiftName;
  cashier: string; // display name
  cashierId: string; // session uid
  status: ShiftStatus;
  openedAt: string;
  openedBy: string;
  openingFloat: number;
  openingCount?: CashCount;
  openingNote?: string;
  // Filled in at close.
  submittedAt?: string; // cashier submitted the count for review
  closedAt?: string; // supervisor approved → locked
  closedBy?: string; // supervisor who approved
  expectedCash?: number; // computed at submit (opening + cash sales − movements)
  actualCash?: number; // counted
  closingCount?: CashCount;
  variance?: number; // actual − expected (negative = short)
  varianceReason?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenNote?: string;
};

export type CashMovementType = "CASH_IN" | "CASH_OUT" | "DROP" | "REFUND" | "BANK_DEPOSIT";
export type CashMovementStatus = "pending" | "approved";

export type CashMovement = {
  id: string; // CM-000001
  shiftId: string;
  posTerminalId: string;
  type: CashMovementType;
  amount: number; // USD-equivalent total (usd part + riel/rate) — drives the drawer
  amountUsd?: number; // the dollars part, as entered
  amountRiel?: number; // the riel part, note face value (e.g. 100000) — kept separate
  reason: string;
  notes?: string;
  attachment?: string; // optional photo/receipt data-URL (cash out)
  bank?: string; // BANK_DEPOSIT only — which bank the cash was deposited to (snapshot)
  reference?: string; // BANK_DEPOSIT only — deposit slip / transaction reference no.
  at: string;
  createdBy: string;
  cashierId: string;
  status: CashMovementStatus;
  approvedBy?: string;
  approvedAt?: string;
};

// A mid-shift money check (the "shift survey"): the drawer is counted and
// checked against what the sales say it should hold, WITHOUT closing the shift.
// Each survey is recorded and a slip is printed, so there's a paper + data trail
// of every check. Dollars and riel counted are kept separate.
export type ShiftSurvey = {
  id: string; // SV-000001
  shiftId: string;
  posTerminalId: string;
  shift: ShiftName;
  at: string;
  by: string; // who ran it (session name)
  byId: string; // session uid
  expected: number; // USD the drawer should hold
  counted: number; // USD-equivalent counted
  variance: number; // counted − expected (negative = short)
  matched: boolean;
  countedUsd: number; // dollars counted, face value
  countedRiel: number; // riel counted, note face value — kept separate
  count: CashCount; // full denomination snapshot
  sales: { total: number; cash: number; card: number; ewallet: number };
  note?: string;
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
  sentBy?: string; // who ticked "sent to supplier"
  sentAt?: string; // when it was marked sent (ISO)
  // Receiving is DONE once goods were received against this PO with the supplier
  // invoice attached — the invoice is the final bill, so that delivery is closed.
  // A closed PO drops off the Receiving list and can no longer be edited or
  // received. Set by the receive/attach-invoice routes; never by the poStatus
  // quantity check (a supplier can bill fewer than ordered and still be done).
  receivingClosed?: boolean;
  closedAt?: string; // when receiving was closed (ISO)
  closedBy?: string; // who submitted the closing receipt / invoice
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
  // Units that sold AFTER this line was counted, read from the POS sales report
  // uploaded into the count. Selling happens in another till, so the shelf keeps
  // emptying while the audit team works: what they counted was true at
  // `countedAt` and nowhere near true by the time the count is posted.
  //
  // Recorded per line at import, because it can only be worked out while the
  // report's row times are in hand — an imported sale is stored grouped by day
  // (stamped noon), so the clock is gone afterwards.
  soldAfterCount?: number;
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

// ── Job Schedule (retail workforce management) ────────────────────────────
// Replaces the Excel manpower schedule. All store-scoped, reusing the store +
// permission systems. A roster person may optionally link to a POS login user
// (userId) so attendance can compare scheduled vs actual clock-in later.

// A shift template — the Excel's 1 / 2 / 3. Admin can edit the times.
export type ShiftTemplate = {
  id: string; // "SHT-1"
  name: string; // "Morning"
  code: number; // 1 = Morning, 2 = Afternoon, 3 = Night (shown in the grid)
  startTime: string; // "06:30" (24h)
  endTime: string; // "15:30" (24h)
  overnight?: boolean; // end time is the NEXT day (night shift)
  color?: string; // brand | amber | violet … tint used in the roster grid
  status: "active" | "inactive";
};

// A work station within the store (Checkout, Drink, Hot Food …). Customizable.
export type Station = { id: string; name: string; active?: boolean };

// A job position / title (Store Manager, Cashier, Store Crew …).
export type Position = { id: string; name: string; active?: boolean };

// A member of the store's staff roster. Most crew have NO POS login — userId is
// an optional link to one for attendance.
export type ScheduleEmployee = {
  id: string; // "EMP-000001"
  name: string;
  phone?: string;
  positionId?: string; // → Position
  stationId?: string; // default station → Station
  defaultShiftId?: string; // default shift → ShiftTemplate
  userId?: string; // optional link to a POS login account
  // A hashed short PIN. When set, this staff can sign into the till by picking
  // their name and typing this PIN (Store Crew / till-only access). Never sent
  // to the client — the API exposes only a `hasPin` flag.
  pinHash?: string;
  active?: boolean; // undefined = active
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

// One cell of the monthly roster: this employee, on this date, works this shift
// (or is OFF). shiftId empty + off true = day off.
export type RosterEntry = {
  id: string; // "RST-000001"
  employeeId: string; // → ScheduleEmployee
  date: string; // "YYYY-MM-DD"
  shiftId?: string; // → ShiftTemplate; empty when off
  off?: boolean; // true = day off
  stationId?: string; // station for this shift → Station
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
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
  ledger: LedgerEntry[];
  historicalPurchases: HistoricalPurchase[];
  promotions: Promotion[];
  promotionUsages: PromotionUsage[];
  auditLog: AuditEvent[];
  queue: QueueTicket[];
  shifts: Shift[];
  cashMovements: CashMovement[];
  surveys: ShiftSurvey[];
  // Job Schedule (workforce management) — store-scoped roster & config.
  shiftTemplates: ShiftTemplate[];
  stations: Station[];
  positions: Position[];
  scheduleEmployees: ScheduleEmployee[];
  rosterEntries: RosterEntry[];
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
    nextLedger: number;
    nextHistorical: number;
    nextPromotion: number;
    nextPromotionUsage: number;
    nextAudit: number;
    nextQueueId: number;
    // The store's shared pickup-number counter. `current` is the last number
    // issued (0 before any); the next sale that asks for a number gets
    // (current % 99) + 1, wrapping 099 → 001.
    queue: { current: number; updatedAt: string };
    nextShift: number;
    nextCashMovement: number;
    nextSurvey: number;
    // Job Schedule counters + one-time defaults-seeded flag.
    nextScheduleEmployee?: number;
    nextRosterEntry?: number;
    scheduleSeeded?: boolean;
    // One-time flag: suppliers have all been defaulted to 10% VAT (after which
    // each supplier's tax rate is managed individually). See backfill().
    supplierTaxInitialized?: boolean;
    // One-time flag: multi-code products imported as "A,B" in one field have
    // been split into barcode + altBarcodes. See backfill() and lib/barcodes.
    barcodesSplit?: boolean;
    // One-time flag: older goods-receipt lines carried no cost of their own, so
    // their documents read the product's CURRENT cost and quietly changed when a
    // price did. Frozen once at the product's cost so a received PO's price is a
    // true snapshot. See backfill(). (New receipts store their cost at receipt.)
    grnCostsFrozen?: boolean;
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
      receipt?: ReceiptSettings; // how the customer receipt is styled (Invoice Customization)
      menuOrder?: string[]; // legacy owner-set order (within-group) — superseded by menuLayout
      // Full owner-set sidebar layout (Menu Layout): each section and the ordered
      // hrefs in it. Lets the owner move a function to a DIFFERENT section, not
      // just reorder within one. Missing/new hrefs fall back to their default group.
      menuLayout?: { group: string; hrefs: string[] }[];
      // Cash drawer ceiling per till: when the expected drawer exceeds this, the
      // money screen prompts a safe drop. In dollars; 0 = no limit.
      cashDrawerLimit?: number;
      // The one bank account the store deposits its cash into. Set once here so a
      // Bank Deposit at the till doesn't ask which bank every time.
      bankAccount?: { name: string; number?: string };
      // The cash float the store always keeps on hand (for change / the next day).
      // Everything in the safe ABOVE this floats to the bank on a bank day, so a
      // Bank Transfer pre-fills its amount = safe cash − this float. In dollars.
      cashFloat?: number;
    };
  };
};
