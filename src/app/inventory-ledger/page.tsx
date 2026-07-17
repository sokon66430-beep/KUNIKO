"use client";

import { useMemo, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { useFetch } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox, Badge, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { num, dateTime } from "@/lib/format";
import type { LedgerEntry, LedgerEntryType } from "@/lib/types";

const TYPE_LABEL: Record<LedgerEntryType, string> = {
  OPENING_BALANCE: "Opening Balance",
  RECEIVING: "Receiving",
  SALE: "Sale (POS)",
  SALES_IMPORT: "Sales Import",
  STOCK_ADJUSTMENT: "Adjustment",
  WRITE_OFF: "Write-Off",
};
const TYPE_TONE: Record<LedgerEntryType, "emerald" | "brand" | "rose" | "amber" | "violet" | "slate"> = {
  OPENING_BALANCE: "violet",
  RECEIVING: "emerald",
  SALE: "brand",
  SALES_IMPORT: "brand",
  STOCK_ADJUSTMENT: "amber",
  WRITE_OFF: "rose",
};

// The permanent movement book: every stock change, signed, with the balance
// after and the document that caused it. Read-only by construction — entries
// are written by the routes that move stock, never here.
export default function InventoryLedgerPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("All");
  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (type !== "All") p.set("type", type);
    p.set("limit", "300");
    return `/api/ledger?${p.toString()}`;
  }, [q, type]);
  const { data, loading, error } = useFetch<{ total: number; rows: LedgerEntry[] }>(url);

  return (
    <div>
      <PageHeader
        title="Inventory Ledger"
        subtitle="Every stock movement on permanent record — what moved, why, who, and the balance after"
      />

      {error && <ErrorBox message={error} />}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Product, barcode, Item ID, or reference (GRN-…, SC-…, INV-…)"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
            {q && (
              <button onClick={() => setQ("")} className="shrink-0 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <SearchSelect
            className="w-48"
            value={type}
            onChange={setType}
            options={[
              { value: "All", label: "All types" },
              ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </Card>

      {loading && !data ? (
        <Spinner label="Loading ledger…" />
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No movements recorded yet"
            hint="The ledger starts writing as soon as stock moves — an opening balance import, receiving, a sales import, a count, a write-off."
            icon={<BookOpen size={18} />}
          />
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-xs text-slate-400">
            Showing {num(data.rows.length)} of {num(data.total)} movement{data.total === 1 ? "" : "s"}, newest first.
          </p>
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Product</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Balance</Th>
              <Th>Reference</Th>
              <Th>By</Th>
            </THead>
            <TBody>
              {data.rows.map((l) => (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap text-slate-500">{dateTime(l.at)}</Td>
                  <Td>
                    <Badge tone={TYPE_TONE[l.type]}>{TYPE_LABEL[l.type]}</Badge>
                  </Td>
                  <Td>
                    <p className="font-medium text-ink-800">{l.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {l.sku}
                      {l.note ? ` · ${l.note}` : ""}
                    </p>
                  </Td>
                  <Td align="right" className={`font-semibold ${l.qty > 0 ? "text-emerald-600" : l.qty < 0 ? "text-rose-500" : "text-slate-400"}`}>
                    {l.qty > 0 ? `+${num(l.qty)}` : num(l.qty)}
                  </Td>
                  <Td align="right" className={l.balance < 0 ? "font-semibold text-rose-500" : ""}>{num(l.balance)}</Td>
                  <Td className="text-slate-500">{l.ref || "—"}</Td>
                  <Td className="text-slate-500">{l.by}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
