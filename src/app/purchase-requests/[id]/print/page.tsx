"use client";

import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { PurchaseRequest, DB } from "@/lib/types";
import { Spinner, ErrorBox } from "@/components/ui";

type Business = DB["meta"]["business"];

const CALIBRI = "'Calibri','Segoe UI',system-ui,sans-serif";
const ARIAL = "Arial,'Helvetica Neue',sans-serif";

const money = (n: number) =>
  `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ddmmyyyy(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const COLW = ["5%", "12%", "31%", "16%", "8%", "10%", "18%"];
const HEADERS = ["NO", "BARCODE", "ITEM NAME", "SUPPLIER", "QTY", "EST. UNIT COST", "EST. AMOUNT"];

export default function PRPrintPage({ params }: { params: { id: string } }) {
  const { data, loading, error } = useFetch<{ pr: PurchaseRequest; business: Business }>(
    `/api/purchase-requests/${params.id}`,
  );

  if (loading) return <Spinner label="Loading purchase request…" />;
  if (error || !data) return <ErrorBox message={error || "Not found"} />;

  const { pr, business } = data;
  const total = pr.items.reduce((s, i) => s + i.cost * i.qty, 0);

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
        <Link href="/purchase-requests" className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      {/* A4 sheet */}
      <div className="po-sheet bg-white p-8 text-black shadow-card" style={{ fontFamily: CALIBRI }}>
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
            PURCHASE REQUEST
          </h1>
        </div>

        {/* Header block */}
        <div
          className="mb-4"
          style={{
            display: "grid",
            // Right-hand label/value pair starts at the same x-position as the
            // "EST. UNIT COST" column in the table below (72% across).
            gridTemplateColumns: "14% 58% 10% 18%",
            columnGap: 12,
            rowGap: 8,
            paddingBottom: 14,
            borderBottom: "1px solid #D1D5DB",
          }}
        >
          <HeaderCell label="PR NUMBER" value={pr.prNo} bold />
          <HeaderCell label="STATUS" value={pr.status} />
          <HeaderCell label="BRANCH" value={business.branch} />
          <HeaderCell label="DATE" value={ddmmyyyy(pr.createdAt)} />
          <HeaderCell label="REQUESTED BY" value={pr.requestedBy} />
          {pr.decidedAt && <HeaderCell label="DECIDED" value={ddmmyyyy(pr.decidedAt)} />}
        </div>

        {pr.note && (
          <div
            className="mb-4"
            style={{ fontFamily: ARIAL, fontSize: 12, background: "#F9FAFB", border: `1px solid #E5E7EB`, borderRadius: 8, padding: "8px 12px" }}
          >
            <span style={{ fontWeight: 700 }}>Note: </span>
            {pr.note}
          </div>
        )}

        {/* Line-item table */}
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
            {pr.items.map((it, i) => {
              const cell = (extra: React.CSSProperties, i2: number): React.CSSProperties => ({
                border,
                borderLeft: i2 === 0 ? borderMed : border,
                borderRight: i2 === HEADERS.length - 1 ? borderMed : border,
                padding: "6px 6px",
                fontSize: 11,
                verticalAlign: "middle",
                ...extra,
              });
              return (
                <tr key={it.productId + i}>
                  <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 0)}>{i + 1}</td>
                  <td style={cell({ fontFamily: ARIAL, textAlign: "center", fontSize: 9.5, letterSpacing: 0 }, 1)}>
                    {it.barcode || ""}
                  </td>
                  <td style={cell({ fontFamily: ARIAL, textAlign: "left" }, 2)}>{it.name}</td>
                  <td style={cell({ fontFamily: ARIAL, textAlign: "left" }, 3)}>{it.supplier}</td>
                  <td style={cell({ fontFamily: CALIBRI, textAlign: "center" }, 4)}>
                    {it.qty} {it.unit}
                  </td>
                  <td style={cell({ fontFamily: CALIBRI, textAlign: "right" }, 5)}>{money(it.cost)}</td>
                  <td style={cell({ fontFamily: CALIBRI, textAlign: "right" }, 6)}>{money(it.cost * it.qty)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ border: "none" }} />
              <td
                style={{
                  border,
                  padding: "6px 6px",
                  fontFamily: CALIBRI,
                  fontWeight: 700,
                  fontSize: 13,
                  textAlign: "left",
                  background: "#FFFF00",
                }}
              >
                TOTAL EST.
              </td>
              <td
                style={{
                  border,
                  padding: "6px 6px",
                  fontFamily: CALIBRI,
                  fontWeight: 700,
                  fontSize: 13,
                  textAlign: "right",
                  background: "#FFFF00",
                }}
              >
                {money(total)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Signature box */}
        <div
          className="mt-6"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            border: borderMed,
            fontFamily: CALIBRI,
          }}
        >
          {["REQUESTED BY", "APPROVED BY"].map((role, idx) => (
            <div
              key={role}
              style={{
                borderRight: idx === 0 ? borderMed : "none",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                minHeight: 110,
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
              <p style={{ fontWeight: 700, fontSize: 11, marginTop: 8 }}>
                Name: {idx === 0 ? pr.requestedBy : ""}
              </p>
              <p style={{ fontSize: 11, marginTop: 6 }}>Date:</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
