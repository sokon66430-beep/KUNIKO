"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { PurchaseOrder, DB } from "@/lib/types";
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

// The PO prints as ONE continuous flow — a single table whose column header
// repeats on each printed page, item rows that never split mid-row, and the
// totals right after the last item. The browser breaks pages naturally when the
// content runs past the bottom of the A4 sheet: items simply fill a page and
// carry on to the next. No hand-pagination.

export default function POPrintPage({ params }: { params: { id: string } }) {
  const { data, loading, error } = useFetch<{ po: PurchaseOrder; business: Business; vatRate?: number }>(
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
  // Tax follows the PO's supplier (0 for a tax-free supplier); the API resolves it.
  const vatRate = data.vatRate ?? business.vatRate ?? 0.1;
  const subtotal = po.items.reduce((s, i) => s + i.cost * i.qtyOrdered, 0);
  const vat = subtotal * vatRate;
  const grand = subtotal + vat;

  // The price-basis note (#3) reads "Prices are EX VAT; VAT 10% added separately"
  // for a taxed PO. On a tax-free PO (no VAT added) the prices are quoted VAT-
  // inclusive, so it becomes "Prices are IN VAT, VAT 10%". The leading number is
  // kept intact.
  const poNotes = (business.poNotes || []).map((n) => {
    if (vatRate === 0 && /ex vat/i.test(n)) {
      const prefix = n.match(/^\s*\d+\.\s*/)?.[0] || "";
      return `${prefix}Prices are IN VAT, VAT 10%`;
    }
    return n;
  });

  const totalsRows = [
    { label: "Subtotal (EX VAT)", value: money(subtotal), yellow: false },
    { label: `VAT (${Math.round(vatRate * 100)}%)`, value: money(vat), yellow: false },
    { label: "GRAND TOTAL", value: money(grand), yellow: true },
  ];

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

      <div className="po-sheet bg-white p-8 text-black shadow-card" style={{ fontFamily: CALIBRI }}>
        {/* Logo, title and header info block — sits once at the top of page 1. */}
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

        {/* One continuous table. The column header repeats on every printed page
            (table-header-group), item rows never split mid-row, and the totals
            follow the last item — the browser page-breaks the flow automatically. */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {COLW.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead style={{ display: "table-header-group" }}>
            <tr>
              {HEADERS.map((h, i) => (
                <th
                  key={h}
                  style={{
                    fontFamily: CALIBRI,
                    fontWeight: 700,
                    fontSize: 10,
                    textAlign: "center",
                    verticalAlign: "middle",
                    padding: "6px 4px",
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
            {po.items.map((it, i) => {
              const cell = (extra: React.CSSProperties, i2: number): React.CSSProperties => ({
                border,
                borderLeft: i2 === 0 ? borderMed : border,
                borderRight: i2 === 8 ? borderMed : border,
                padding: "3px 6px",
                fontSize: 10,
                verticalAlign: "middle",
                ...extra,
              });
              return (
                <tr key={it.productId + i} style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                  <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 0)}>{i + 1}</td>
                  <td style={cell({ fontFamily: ARIAL, textAlign: "center", fontSize: 9, letterSpacing: 0 }, 1)}>
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
          {/* Totals kept together (own row group) and flowing after the last item. */}
          <tbody style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
            {totalsRows.map((row) => (
              <tr key={row.label}>
                <td colSpan={7} style={{ border: "none" }} />
                <td
                  style={{
                    border,
                    padding: "5px 6px",
                    fontFamily: CALIBRI,
                    fontWeight: 700,
                    fontSize: 12,
                    textAlign: "left",
                    background: row.yellow ? "#FFFF00" : undefined,
                  }}
                >
                  {row.label}
                </td>
                <td
                  style={{
                    border,
                    padding: "5px 6px",
                    fontFamily: CALIBRI,
                    fontWeight: 700,
                    fontSize: 12,
                    textAlign: "right",
                    background: row.yellow ? "#FFFF00" : undefined,
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Notes + signature — flow after the table, kept together as one block. */}
        <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
          <div style={{ fontFamily: ARIAL, fontSize: 12, lineHeight: 1.4 }} className="mt-4">
            <p style={{ fontWeight: 700 }}>Notes:</p>
            {poNotes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
            {business.invoiceTo?.map((n, i) => (
              <p key={`inv-${i}`}>{i === 0 ? `4. ${n}` : n}</p>
            ))}
          </div>

          <div
            className="mt-4"
            style={{
              display: "grid",
              gridTemplateColumns: "51.6% 17.7% 30.7%",
              border: borderMed,
              fontFamily: CALIBRI,
            }}
          >
            <div style={{ borderRight: borderMed, padding: 8, minHeight: 112 }}>
              <span style={{ fontWeight: 700, fontSize: 11 }}>Remark:</span>
            </div>
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
                <div style={{ marginTop: "auto", borderTop: border, paddingTop: 3, textAlign: "center", fontSize: 10 }}>
                  Signature
                </div>
                <p style={{ fontWeight: 700, fontSize: 11, marginTop: 8 }}>Name:</p>
                <p style={{ fontSize: 11, marginTop: 6 }}>Date:</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
