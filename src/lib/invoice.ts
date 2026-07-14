import type { InvoiceReview } from "./types";

// Every page of a receipt's invoice. Uses the `images` list when present, else
// falls back to the single `image` (older, single-page receipts).
export function invoicePages(inv?: InvoiceReview | null): string[] {
  if (!inv) return [];
  if (inv.images && inv.images.length) return inv.images;
  return inv.image ? [inv.image] : [];
}
