"use client";

import { useRef, useState } from "react";
import { Upload, PackageCheck, CheckCircle2, AlertTriangle, Download, ArrowRight } from "lucide-react";
import { PageHeader, StatCard, Card, Badge, Table, THead, Th, TBody, Tr, Td, EmptyState } from "@/components/ui";
import { num } from "@/lib/format";

type RowResult = {
  row: number;
  barcode: string;
  name: string;
  qty: number;
  issue?: string;
  matchedName?: string;
  prevStock?: number;
};
type ImportResult = {
  mode: "preview" | "commit";
  total: number;
  valid: number;
  failed: number;
  units?: number;
  rows: RowResult[];
};

// Owner-only migration screen: import the audit team's physical count as each
// product's opening balance. Preview first (nothing written), then commit —
// valid rows post OPENING_BALANCE to the inventory ledger, failed rows are
// reported and downloadable for fixing. The page is deliberately explicit
// about the one-way nature: a product takes exactly one opening.
export default function OpeningInventoryPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/opening-inventory?mode=${mode}`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }

  function downloadFailed() {
    if (!result) return;
    const failed = result.rows.filter((r) => r.issue);
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "Row,Barcode,Product Name,Quantity,Issue",
      ...failed.map((r) => [r.row, esc(r.barcode), esc(r.name), r.qty, esc(r.issue)].join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "opening-inventory-failed-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const failedRows = result ? result.rows.filter((r) => r.issue) : [];
  const committed = result?.mode === "commit";

  return (
    <div>
      <PageHeader
        title="Opening Inventory"
        subtitle="Import the audit team's physical count as the official starting stock — posted to the inventory ledger as each product's opening balance"
      />

      {/* The migration path, so the one-time nature is explicit */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
          {["Old purchase history (reports only)", "Physical stock count", "Opening balance", "Daily sales import + receiving", "Accurate stock"].map(
            (step, i, all) => (
              <span key={step} className="flex items-center gap-2">
                <span
                  className={`rounded-lg px-2.5 py-1.5 font-semibold ${
                    i === 2 ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {step}
                </span>
                {i < all.length - 1 && <ArrowRight size={14} className="text-slate-300" />}
              </span>
            ),
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          The file needs <b>Barcode</b> (or Product Name), <b>Quantity</b>, and optionally <b>Store</b> columns — .xlsx or
          .csv. Each product accepts exactly one opening balance; corrections after that belong to a stock count, so the
          adjustment trail stays honest. Old purchase reports must NOT be imported here — they go to{" "}
          <a href="/historical-purchases" className="font-semibold text-brand-600 hover:underline">
            Purchase History
          </a>
          , which never touches stock.
        </p>
      </Card>

      {/* Upload + actions */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {file ? file.name : "Choose file (.xlsx / .csv)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <button className="btn-ghost" disabled={!file || busy !== null} onClick={() => run("preview")}>
            {busy === "preview" ? "Checking…" : "Check file"}
          </button>
          <button
            className="btn-primary"
            disabled={!file || busy !== null || !result || result.mode === "commit" || result.valid === 0}
            onClick={() => run("commit")}
            title={!result ? "Check the file first" : result.valid === 0 ? "No valid rows to post" : `Post ${num(result.valid)} opening balances`}
          >
            <PackageCheck size={16} /> {busy === "commit" ? "Posting…" : "Post opening balances"}
          </button>
          {error && <span className="text-sm font-semibold text-rose-600">{error}</span>}
        </div>
      </Card>

      {result && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Rows in File" value={num(result.total)} icon={<Upload size={18} />} accent="brand" />
            <StatCard
              label={committed ? "Posted" : "Valid"}
              value={num(result.valid)}
              sub={committed && result.units != null ? `${num(result.units)} units opened` : undefined}
              icon={<CheckCircle2 size={18} />}
              accent="emerald"
            />
            <StatCard label="Failed" value={num(result.failed)} icon={<AlertTriangle size={18} />} accent={result.failed ? "rose" : "brand"} />
            <StatCard
              label="Status"
              value={committed ? "Posted" : "Preview"}
              sub={committed ? "opening balances in the ledger" : "nothing written yet"}
              icon={<PackageCheck size={18} />}
              accent={committed ? "emerald" : "amber"}
            />
          </div>

          {failedRows.length > 0 && (
            <Card className="mb-6" title={`Failed rows (${num(failedRows.length)})`} icon={<AlertTriangle size={15} className="text-rose-500" />}>
              <div className="mb-3">
                <button className="btn-ghost !py-1.5 text-xs" onClick={downloadFailed}>
                  <Download size={14} /> Download failed rows (CSV)
                </button>
              </div>
              <Table>
                <THead>
                  <Th>Row</Th>
                  <Th>Barcode</Th>
                  <Th>Product</Th>
                  <Th align="right">Qty</Th>
                  <Th>Issue</Th>
                </THead>
                <TBody>
                  {failedRows.slice(0, 200).map((r) => (
                    <Tr key={r.row}>
                      <Td className="text-slate-400">{r.row}</Td>
                      <Td className="font-mono text-xs">{r.barcode || "—"}</Td>
                      <Td>{r.name || "—"}</Td>
                      <Td align="right">{isFinite(r.qty) ? num(r.qty) : "—"}</Td>
                      <Td className="text-rose-600">{r.issue}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              {failedRows.length > 200 && (
                <p className="mt-2 text-xs text-slate-400">Showing 200 of {num(failedRows.length)} — the CSV has them all.</p>
              )}
            </Card>
          )}

          <Card title={committed ? "Posted opening balances" : "Valid rows — will be posted"} icon={<CheckCircle2 size={15} className="text-emerald-600" />}>
            {result.rows.filter((r) => !r.issue).length === 0 ? (
              <EmptyState title="No valid rows" hint="Fix the issues above and upload again." icon={<AlertTriangle size={18} />} />
            ) : (
              <Table>
                <THead>
                  <Th>Barcode</Th>
                  <Th>Product</Th>
                  <Th align="right">Opening Qty</Th>
                  <Th align="right">Replaces</Th>
                  <Th></Th>
                </THead>
                <TBody>
                  {result.rows
                    .filter((r) => !r.issue)
                    .slice(0, 300)
                    .map((r) => (
                      <Tr key={r.row}>
                        <Td className="font-mono text-xs">{r.barcode || "—"}</Td>
                        <Td>{r.matchedName || r.name}</Td>
                        <Td align="right" className="font-semibold">{num(r.qty)}</Td>
                        <Td align="right" className="text-slate-400">
                          {r.prevStock != null && r.prevStock !== 0 ? num(r.prevStock) : "—"}
                        </Td>
                        <Td>{committed ? <Badge tone="emerald">Posted</Badge> : <Badge tone="muted">Ready</Badge>}</Td>
                      </Tr>
                    ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
