"use client";

import { useRef, useState } from "react";
import { Upload, History, Package, DollarSign, Link2, Trash2, ShieldOff } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { confirmDialog } from "@/components/confirm";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { num, usd, dateTime } from "@/lib/format";
import type { HistoricalPurchase } from "@/lib/types";

type Summary = {
  total: number;
  units: number;
  value: number;
  linked: number;
  suppliers: { name: string; rows: number; units: number; value: number }[];
  topProducts: { name: string; units: number; value: number }[];
  rows: HistoricalPurchase[];
};

// The old "Stock In Report", kept for purchase & supplier analysis. Reporting
// only — these rows have no path to stock, and the page says so up front so
// nobody mistakes 10,000 purchased for 10,000 on the shelf.
export default function HistoricalPurchasesPage() {
  const { data, loading, error, reload } = useFetch<Summary>("/api/historical-purchases");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/historical-purchases", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Import failed");
      setMsg(
        `Imported ${num(d.added)} rows — stock NOT affected${
          d.unlinked ? ` · ${num(d.unlinked)} not matched to the master (kept as text)` : ""
        }${d.skipped ? ` · ${num(d.skipped)} summary/zero rows skipped` : ""}`,
      );
      reload();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearAll() {
    if (
      !(await confirmDialog({
        title: "Clear purchase history",
        message: "Remove every imported historical purchase row? Stock is not touched either way — this only empties the analysis data.",
        confirmText: "Clear history",
        tone: "danger",
      }))
    )
      return;
    try {
      await api("/api/historical-purchases", { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase History"
        subtitle="The pre-Stookii Stock-In Report — supplier and purchase analysis only. These figures never touch inventory."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> {importing ? "Importing…" : "Import Stock-In Report"}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onFile} />
            {(data?.total || 0) > 0 && (
              <button className="btn-danger" onClick={clearAll} title="Remove all imported history rows (stock unaffected)">
                <Trash2 size={16} /> Clear
              </button>
            )}
          </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {msg && <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-xs text-brand-800">{msg}</div>}

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        <ShieldOff size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>No inventory impact — by design.</b> Historical purchases are what the company bought over the years, not
          what is on the shelf today. The official starting stock comes from the audit team&apos;s count on{" "}
          <a href="/opening-inventory" className="font-semibold underline">
            Opening Inventory
          </a>
          .
        </span>
      </div>

      {loading && !data ? (
        <Spinner label="Loading history…" />
      ) : !data || data.total === 0 ? (
        <Card>
          <EmptyState
            title="No purchase history imported yet"
            hint="Upload the old Stock-In Report (.xlsx) — columns like Barcode / Item Code, Product Name, Quantity, and optionally Supplier, Cost and Date."
            icon={<History size={18} />}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="History Rows" value={num(data.total)} icon={<History size={18} />} accent="brand" />
            <StatCard label="Units Purchased" value={num(data.units)} icon={<Package size={18} />} accent="violet" />
            <StatCard label="Purchase Value" value={usd(data.value)} sub="where the report carried a cost" icon={<DollarSign size={18} />} accent="emerald" />
            <StatCard
              label="Matched to Master"
              value={num(data.linked)}
              sub={data.total ? `${Math.round((data.linked / data.total) * 100)}% of rows` : undefined}
              icon={<Link2 size={18} />}
              accent={data.linked === data.total ? "emerald" : "amber"}
            />
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card title="By supplier" subtitle="Who the company bought from" icon={<History size={15} />}>
              <Table>
                <THead>
                  <Th>Supplier</Th>
                  <Th align="right">Rows</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Value</Th>
                </THead>
                <TBody>
                  {data.suppliers.slice(0, 15).map((s) => (
                    <Tr key={s.name}>
                      <Td>{s.name}</Td>
                      <Td align="right">{num(s.rows)}</Td>
                      <Td align="right">{num(s.units)}</Td>
                      <Td align="right">{s.value ? usd(s.value) : "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              {data.suppliers.length > 15 && (
                <p className="mt-2 text-xs text-slate-400">Top 15 of {num(data.suppliers.length)} suppliers by value.</p>
              )}
            </Card>

            <Card title="Most purchased products" subtitle="All-time units from the old report" icon={<Package size={15} />}>
              <Table>
                <THead>
                  <Th>Product</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Value</Th>
                </THead>
                <TBody>
                  {data.topProducts.slice(0, 15).map((p) => (
                    <Tr key={p.name}>
                      <Td>{p.name}</Td>
                      <Td align="right">{num(p.units)}</Td>
                      <Td align="right">{p.value ? usd(p.value) : "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>

          <Card title="Recent imported rows" subtitle={`Last ${num(Math.min(500, data.total))} of ${num(data.total)}`}>
            <Table>
              <THead>
                <Th>Product</Th>
                <Th>Supplier</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Cost</Th>
                <Th>Date</Th>
                <Th>Linked</Th>
              </THead>
              <TBody>
                {data.rows.slice(0, 100).map((h) => (
                  <Tr key={h.id}>
                    <Td>
                      <p>{h.name}</p>
                      <p className="text-[11px] text-slate-400">{h.barcode || h.sku || ""}</p>
                    </Td>
                    <Td className="text-slate-500">{h.supplier || "—"}</Td>
                    <Td align="right">{num(h.qty)}</Td>
                    <Td align="right">{h.cost != null ? usd(h.cost) : "—"}</Td>
                    <Td className="text-slate-500">{h.date || dateTime(h.importedAt)}</Td>
                    <Td>{h.productId ? <Badge tone="emerald">Linked</Badge> : <Badge tone="amber">Text only</Badge>}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
