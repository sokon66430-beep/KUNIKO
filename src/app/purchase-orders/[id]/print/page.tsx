"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { PurchaseOrder, POItem, DB } from "@/lib/types";
import { Spinner, ErrorBox } from "@/components/ui";

type Business = DB["meta"]["business"];

// Font stacks matching the Excel (Windows fonts, present when printing on the store PC)
const CALIBRI = "'Calibri','Segoe UI',system-ui,sans-serif";
const ARIAL = "Arial,'Helvetica Neue',sans-serif";
const TAHOMA = "Tahoma,'Segoe UI',sans-serif";

const money = (n: number) =>
  `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ddmmyyyy(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// When no expected-arrival date was set on the PO, default the printed EST.
// ARRIVAL to the day after the order date instead of leaving it blank.
function estArrival(expectedDate: string | undefined, createdAt: string): string {
  if (expectedDate) return ddmmyyyy(expectedDate);
  const d = new Date(createdAt);
  d.setDate(d.getDate() + 1);
  return ddmmyyyy(d.toISOString());
}

// Column widths (must total 100 for the fixed table layout). Numeric columns get
// enough room for their header to wrap cleanly instead of overflowing.
const COLW = ["5%", "12%", "31%", "8%", "6%", "7%", "11%", "11%", "9%"];
const HEADERS = [
  "NO",
  "BARCODE",
  "ITEM NAME",
  "UOM (Size)",
  "QTY (Units)",
  "UOM Type",
  "Unit Price (ex VAT)",
  "Box Price (ex VAT)",
  "Amount",
];

// Chrome's print-to-PDF has no support for automatic per-page footers, so page
// breaks and "Page X of Y" numbers are laid out by hand here. If a page's
// content overflowed A4 the browser would auto-split it and strand the totals,
// so per-page row capacities are derived from measured block heights (taken at
// the ~703px print content width) with headroom, and never exceeded.
//
// The totals + notes + signature block ALWAYS sits directly beneath real item
// rows — it never gets a page of its own (an empty item table with the totals
// floating off to one side is exactly the "footer sitting too high" look), so a
// final page that's too tall to also hold the footer is split to make room.
const A4_USABLE_PX = 1032; // A4 portrait, 297mm − 2×12mm margins, at 96dpi
const ROW_PX = 36; // one item row, with headroom for a two-line item name
const TOP_MATTER_PX = 255; // page 1: logo/title/info block + column header + page number
const CONT_MATTER_PX = 69; // continuation page: column header + page number only
const FOOTER_PX = 402; // totals + notes + signature block

const cap = (matter: number) => Math.floor((A4_USABLE_PX - matter) / ROW_PX);
const HEADER_PAGE_CAP = cap(TOP_MATTER_PX); // page 1, items only
const CONT_PAGE_CAP = cap(CONT_MATTER_PX); // continuation page, items only
const HEADER_PAGE_WITH_FOOTER_CAP = cap(TOP_MATTER_PX + FOOTER_PX); // page 1 that also carries the footer
const CONT_PAGE_WITH_FOOTER_CAP = cap(CONT_MATTER_PX + FOOTER_PX); // continuation page that also carries the footer

export default function POPrintPage({ params }: { params: { id: string } }) {
  const { data, loading, error } = useFetch<{ po: PurchaseOrder; business: Business }>(
    `/api/purchase-orders/${params.id}`,
  );

  // Name the saved file "<PO number>-<Supplier name>" — the browser uses the
  // document title as the default "Save as PDF" filename. Strip characters that
  // aren't allowed in filenames, and drop the supplier when it's blank.
  useEffect(() => {
    if (!data) return;
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const poNo = clean(data.po.poNo || "");
    const supplier = clean(data.po.supplier || "");
    const name = supplier && supplier !== "—" ? `${poNo}-${supplier}` : poNo;
    const prev = document.title;
    if (name) document.title = name;
    return () => {
      document.title = prev;
    };
  }, [data]);

  if (loading) return <Spinner label="Loading purchase order…" />;
  if (error || !data) return <ErrorBox message={error || "Not found"} />;

  const { po, business } = data;
  const vatRate = business.vatRate ?? 0.1;
  const subtotal = po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);
  const vat = subtotal * vatRate;
  const grand = subtotal + vat;

  // Split the items into per-page chunks (page 1 holds fewer rows because of the
  // header block above it).
  const chunks: POItem[][] = [];
  for (let i = 0; i < po.items.length; ) {
    const cap = chunks.length === 0 ? HEADER_PAGE_CAP : CONT_PAGE_CAP;
    chunks.push(po.items.slice(i, i + cap));
    i += cap;
  }
  if (chunks.length === 0) chunks.push([]);

  // The totals/notes/signature block goes under the LAST chunk. The footer page
  // carries an extra FOOTER_PX, so it holds fewer item rows than a plain page —
  // `balancedSplit` returns how many of `count` rows to keep on the (items-only)
  // page above so the two pages come out roughly equal in height, clamped so the
  // footer page holds ≥1 row and never exceeds its capacity.
  const footerMatter = CONT_MATTER_PX + FOOTER_PX;
  const balancedSplit = (count: number, precedingMatter: number, precedingCap: number) => {
    const raw = Math.round((footerMatter - precedingMatter + count * ROW_PX) / (2 * ROW_PX));
    return Math.max(1, count - CONT_PAGE_WITH_FOOTER_CAP, Math.min(raw, precedingCap, count - 1));
  };

  // (1) If the final chunk is too tall to also carry the footer, peel a balanced
  //     footer page off the end so the totals never land on an empty table.
  const lastFooterCap = chunks.length === 1 ? HEADER_PAGE_WITH_FOOTER_CAP : CONT_PAGE_WITH_FOOTER_CAP;
  if (chunks[chunks.length - 1].length > lastFooterCap) {
    const last = chunks[chunks.length - 1];
    const onPageOne = chunks.length === 1;
    const keep = balancedSplit(last.length, onPageOne ? TOP_MATTER_PX : CONT_MATTER_PX, onPageOne ? HEADER_PAGE_CAP : CONT_PAGE_CAP);
    chunks[chunks.length - 1] = last.slice(0, keep);
    chunks.push(last.slice(keep));
  }

  // (2) Re-balance the final two pages so a small remainder (e.g. a single row
  //     that greedy chunking spilled onto its own page) doesn't leave the footer
  //     page with a lone orphan row. Stable when the pages are already balanced.
  if (chunks.length >= 2) {
    const a = chunks.length - 2;
    const merged = chunks[a].concat(chunks[a + 1]);
    const onPageOne = a === 0;
    const keep = balancedSplit(merged.length, onPageOne ? TOP_MATTER_PX : CONT_MATTER_PX, onPageOne ? HEADER_PAGE_CAP : CONT_PAGE_CAP);
    chunks.splice(a, 2, merged.slice(0, keep), merged.slice(keep));
  }

  type PageSpec = { items: POItem[]; startIndex: number; showFooter: boolean };
  let runningIndex = 0;
  const pages: PageSpec[] = chunks.map((chunk, idx) => {
    const spec: PageSpec = { items: chunk, startIndex: runningIndex, showFooter: idx === chunks.length - 1 };
    runningIndex += chunk.length;
    return spec;
  });
  const totalPages = pages.length;

  const HeaderCell = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <>
      <div
        style={{
          fontFamily: CALIBRI,
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: 0.5,
          color: "#6B7280",
          textTransform: "uppercase",
          alignSelf: "center",
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: CALIBRI, fontWeight: bold ? 700 : 500, fontSize: 11, color: "#111", alignSelf: "center" }}>
        {value}
      </div>
    </>
  );

  const border = "1px solid #000";
  const borderMed = "2px solid #000";

  return (
    <div className="mx-auto max-w-[960px]">
      {/* Toolbar — hidden when printing */}
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/purchase-orders" className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      {pages.map((pg, p) => (
        <div
          key={p}
          className="po-sheet mb-8 bg-white p-8 text-black shadow-card print:mb-0"
          style={{
            fontFamily: CALIBRI,
            breakAfter: p < totalPages - 1 ? "page" : "auto",
            pageBreakAfter: p < totalPages - 1 ? "always" : "auto",
          }}
        >
          {/* Logo, title and the full header info block only appear on page 1 —
              continuation pages go straight to the item table. */}
          {p === 0 && (
            <>
              <div className="mb-5" style={{ position: "relative" }}>
                {business.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={business.logo}
                    alt="Logo"
                    style={{ position: "absolute", top: -27, left: 0, maxHeight: 56, maxWidth: 170, objectFit: "contain" }}
                  />
                )}
                <h1
                  style={{ fontFamily: CALIBRI, fontWeight: 700, fontSize: 30, letterSpacing: 1, marginTop: 38 }}
                  className="text-center"
                >
                  PURCHASE ORDER
                </h1>
              </div>

              <div
                className="mb-4"
                style={{
                  display: "grid",
                  // Right-hand label/value pair starts at the same x-position as the
                  // "Unit Price (ex VAT)" column in the table below (69% across).
                  gridTemplateColumns: "14% 55% 13% 18%",
                  columnGap: 12,
                  rowGap: 8,
                  paddingBottom: 14,
                  borderBottom: "1px solid #D1D5DB",
                }}
              >
                <HeaderCell label="SUPPLIER" value={po.supplier} bold />
                <HeaderCell label="PO NUMBER" value={po.poNo} />
                <HeaderCell label="BRANCH" value={business.branch} />
                <HeaderCell label="ORDER DATE" value={ddmmyyyy(po.createdAt)} />
                <HeaderCell label="SHIP TO" value={business.shipTo} />
                <HeaderCell label="EST. ARRIVAL" value={estArrival(po.expectedDate, po.createdAt)} />
                <HeaderCell label="RECEIVED BY" value={business.receivedBy} />
                <HeaderCell label="Requested By" value={business.authorizedBy} />
              </div>
            </>
          )}

          {/* Line-item table. The totals row (tfoot) always follows real item
              rows on the same page, keeping the column alignment intact. */}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                {COLW.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {HEADERS.map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontFamily: CALIBRI,
                        fontWeight: 700,
                        fontSize: 10.5,
                        textAlign: "center",
                        verticalAlign: "middle",
                        padding: "8px 4px",
                        background: "#F2F3F5",
                        borderTop: borderMed,
                        borderBottom: borderMed,
                        borderLeft: i === 0 ? borderMed : border,
                        borderRight: i === HEADERS.length - 1 ? borderMed : border,
                        lineHeight: 1.15,
                        overflowWrap: "break-word",
                        wordBreak: "break-word",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.items.map((it, i) => {
                  const rowNo = pg.startIndex + i + 1;
                  const cell = (extra: React.CSSProperties, i2: number): React.CSSProperties => ({
                    border,
                    borderLeft: i2 === 0 ? borderMed : border,
                    borderRight: i2 === 8 ? borderMed : border,
                    padding: "6px 6px",
                    fontSize: 11,
                    verticalAlign: "middle",
                    ...extra,
                  });
                  return (
                    <tr key={it.productId + rowNo}>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 0)}>{rowNo}</td>
                      <td style={cell({ fontFamily: ARIAL, textAlign: "center", fontSize: 9.5, letterSpacing: 0 }, 1)}>
                        {it.barcode || ""}
                      </td>
                      <td style={cell({ fontFamily: ARIAL, textAlign: "left" }, 2)}>{it.name}</td>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 3)}>{it.uomSize || "-"}</td>
                      <td style={cell({ fontFamily: TAHOMA, textAlign: "center" }, 4)}>{it.qtyOrdered}</td>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 5)}>unit</td>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "right" }, 6)}>{money(it.cost)}</td>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 7)}>-</td>
                      <td style={cell({ fontFamily: CALIBRI, textAlign: "right" }, 8)}>{money(it.cost * it.qtyOrdered)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {pg.showFooter && (
                <tfoot>
                  {[
                    { label: "Subtotal (EX VAT)", value: money(subtotal), yellow: false },
                    { label: `VAT (${Math.round(vatRate * 100)}%)`, value: money(vat), yellow: false },
                    { label: "GRAND TOTAL", value: money(grand), yellow: true },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td colSpan={7} style={{ border: "none" }} />
                      <td
                        style={{
                          border,
                          padding: "6px 6px",
                          fontFamily: CALIBRI,
                          fontWeight: 700,
                          fontSize: 13,
                          textAlign: "left",
                          background: row.yellow ? "#FFFF00" : undefined,
                        }}
                      >
                        {row.label}
                      </td>
                      <td
                        style={{
                          border,
                          padding: "6px 6px",
                          fontFamily: CALIBRI,
                          fontWeight: 700,
                          fontSize: 13,
                          textAlign: "right",
                          background: row.yellow ? "#FFFF00" : undefined,
                        }}
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>

          {pg.showFooter && (
            <>
              {/* Notes — Arial */}
              <div style={{ fontFamily: ARIAL, fontSize: 12, lineHeight: 1.4 }} className="mt-4">
                <p style={{ fontWeight: 700 }}>Notes:</p>
                {business.poNotes?.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
                {business.invoiceTo?.map((n, i) => (
                  <p key={`inv-${i}`}>{i === 0 ? `4. ${n}` : n}</p>
                ))}
              </div>

              {/* Remark + signature box */}
              <div
                className="mt-4"
                style={{
                  display: "grid",
                  gridTemplateColumns: "51.6% 17.7% 30.7%",
                  border: borderMed,
                  fontFamily: CALIBRI,
                }}
              >
                {/* Remark */}
                <div style={{ borderRight: borderMed, padding: 8, minHeight: 112 }}>
                  <span style={{ fontWeight: 700, fontSize: 11 }}>Remark:</span>
                </div>
                {/* Approved / Received */}
                {["APPROVED BY", "RECEIVED BY"].map((role, idx) => (
                  <div
                    key={role}
                    style={{
                      borderRight: idx === 0 ? borderMed : "none",
                      padding: 8,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 11 }}>{role}</span>
                    <div
                      style={{
                        marginTop: "auto",
                        borderTop: border,
                        paddingTop: 3,
                        textAlign: "center",
                        fontSize: 10,
                      }}
                    >
                      Signature
                    </div>
                    <p style={{ fontWeight: 700, fontSize: 11, marginTop: 8 }}>Name:</p>
                    <p style={{ fontSize: 11, marginTop: 6 }}>Date:</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Page number — printed on every page since Chrome's print-to-PDF
              has no automatic per-page footer support. */}
          <div style={{ fontFamily: CALIBRI, fontSize: 10, color: "#6B7280", textAlign: "center", marginTop: 12 }}>
            Page {p + 1} of {totalPages}
          </div>
        </div>
      ))}
    </div>
  );
}
