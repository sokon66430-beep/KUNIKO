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
  gondola?: string; // PRIMARY gondola (most recently set) — printed on the label
  shelf?: string; // primary shelf position within the gondola
  // A product can sit in several places; every registered spot is kept here so
  // the stock count sheet lists them all. `gondola`/`shelf` mirror the latest.
  locations?: ProductLocation[];
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
  price: number; // unit sell price at time of sale
  cost: number; // unit cost at time of sale
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
  createdAt: string;
  imported?: boolean; // true when brought in from a sales-history import (no stock change)
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
  image: string; // stored file name, served via /api/invoice-image/[name]
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

export type AuditEntityType = "PR" | "PO" | "GRN" | "Product" | "Supplier" | "Stock" | "Count" | "WriteOff" | "Sale";

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
  suppliers: Supplier[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  stockCounts: StockCount[];
  writeOffs: WriteOff[];
  auditLog: AuditEvent[];
  meta: {
    nextInvoice: number;
    nextPR: number;
    nextPO: number;
    nextGRN: number;
    nextStockCount: number;
    nextWriteOff: number;
    nextAudit: number;
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
