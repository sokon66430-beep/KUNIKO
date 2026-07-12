"use client";

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

// One printed A4 page holds at most this many item rows. When an order has
// more lines than fit, it's split across multiple pages (each labelled
// "Page X of Y") — Chrome's print-to-PDF has no support for automatic
// per-page footers, so the page breaks and numbers are laid out by hand here.
const ROWS_PER_PAGE = 20;
// If the final chunk of items has more rows than this, the totals/notes/
// signature block gets its own trailing page instead of being squeezed in.
const FOOTER_ROOM_ROWS = 10;

export default function POPrintPage({ params }: { params: { id: string } }) {
  const { data, loading, error } = useFetch<{ po: PurchaseOrder; business: Business }>(
    `/api/purchase-orders/${params.id}`,
  );

  if (loading) return <Spinner label="Loading purchase order…" />;
  if (error || !data) return <ErrorBox message={error || "Not found"} />;

  const { po, business } = data;
  const vatRate = business.vatRate ?? 0.1;
  const subtotal = po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);
  const vat = subtotal * vatRate;
  const grand = subtotal + vat;

  // Split the items into per-page chunks, and decide whether the totals/notes/
  // signature block needs a trailing page of its own.
  const itemChunks: POItem[][] = [];
  for (let i = 0; i < po.items.length; i += ROWS_PER_PAGE) itemChunks.push(po.items.slice(i, i + ROWS_PER_PAGE));
  if (itemChunks.length === 0) itemChunks.push([]);
  const footerNeedsOwnPage = itemChunks[itemChunks.length - 1].length > FOOTER_ROOM_ROWS;

  type PageSpec = { items: POItem[] | null; startIndex: number; showFooter: boolean };
  const pages: PageSpec[] = itemChunks.map((chunk, idx) => ({
    items: chunk,
    startIndex: idx * ROWS_PER_PAGE,
    showFooter: idx === itemChunks.length - 1 && !footerNeedsOwnPage,
  }));
  if (footerNeedsOwnPage) pages.push({ items: null, startIndex: po.items.length, showFooter: true });
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
          {/* Logo pinned to the top-left corner; title stays centered on the sheet */}
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

          {/* Header block — 4 rows, two label/value blocks, thin rule underneath */}
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
            <HeaderCell label="EST. ARRIVAL" value={ddmmyyyy(po.expectedDate)} />
            <HeaderCell label="RECEIVED BY" value={business.receivedBy} />
            <HeaderCell label="Requested By" value={business.authorizedBy} />
          </div>

          {/* Line-item table. On a trailing page dedicated to totals/notes/signature
              (pg.items === null), tbody is empty but the table still renders so the
              totals row keeps the same column alignment as the item rows above. */}
          {(pg.items !== null || pg.showFooter) && (
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
                {(pg.items || []).map((it, i) => {
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
          )}

          {pg.showFooter && (
            <>
              {/* Notes — Arial */}
              <div style={{ fontFamily: ARIAL, fontSize: 13, lineHeight: 1.5 }} className="mt-6">
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
                className="mt-6"
                style={{
                  display: "grid",
                  gridTemplateColumns: "51.6% 17.7% 30.7%",
                  border: borderMed,
                  fontFamily: CALIBRI,
                }}
              >
                {/* Remark */}
                <div style={{ borderRight: borderMed, padding: 8, minHeight: 150 }}>
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
          <div style={{ fontFamily: CALIBRI, fontSize: 10, color: "#6B7280", textAlign: "right", marginTop: 12 }}>
            Page {p + 1} of {totalPages}
          </div>
        </div>
      ))}
    </div>
  );
}
