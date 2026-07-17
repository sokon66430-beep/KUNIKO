"use client";

import { useMemo, useState } from "react";
import { TicketPercent, TrendingDown, PackageX, CircleSlash, FileSpreadsheet, FileType2, FileDown } from "lucide-react";
import { useFetch, useAccess } from "@/lib/client";
import { canSeeProfit } from "@/lib/access";
import type { MarkdownReportRow } from "@/lib/markdownReport";
import { markdownReportTotals } from "@/lib/markdownReport";
import { PageHeader, StatCard, Card, Spinner, EmptyState, Badge, Table, THead, Th, TBody, Tr, Td } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { usd, num } from "@/lib/format";
import { storeToday, shortDay } from "@/lib/storetime";

const STATUS_TONE: Record<string, any> = {
  Active: "emerald",
  Scheduled: "brand",
  Expired: "slate",
  Cancelled: "rose",
};

// Default window: this month so far. Wide enough to hold a clearance run,
// narrow enough that the page opens on something readable.
function monthStart(): string {
  return `${storeToday().slice(0, 7)}-01`;
}

export default function MarkdownReportsPage() {
  const { role, caps } = useAccess();
  const showProfit = role == null || canSeeProfit(role, caps);

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(storeToday());
  const [status, setStatus] = useState("All");
  const [q, setQ] = useState("");

  const { data, loading } = useFetch<MarkdownReportRow[]>("/api/markdown-report");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data || [])
      // Filtered on the LAST SELLING DAY, not the day the label was made: this
      // answers "what did we clear in July", and a label made in June to run
      // through July belongs to July.
      .filter((r) => (!from || r.endDate >= from) && (!to || r.endDate <= to))
      .filter((r) => status === "All" || r.status === status)
      .filter(
        (r) =>
          !needle ||
          r.name.toLowerCase().includes(needle) ||
          r.sku.toLowerCase().includes(needle) ||
          r.code.includes(needle) ||
          (r.category || "").toLowerCase().includes(needle),
      );
  }, [data, from, to, status, q]);

  const totals = useMemo(() => markdownReportTotals(rows), [rows]);

  const exportHref = (format: string) =>
    `/api/reports/markdowns/export?format=${format}&from=${from}&to=${to}&status=${status}`;

  return (
    <div>
      <PageHeader
        title="Mark Down Report"
        subtitle="Every label that has run — what it cleared, and what the discount cost"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Labels" value={num(totals.labels)} sub="in this window" icon={<TicketPercent size={18} />} />
        <StatCard
          label="Units cleared"
          value={num(totals.qtySold)}
          sub={`${usd(totals.revenue)} taken`}
          icon={<PackageX size={18} />}
          accent="emerald"
        />
        <StatCard
          label="Discount given"
          value={usd(totals.discountGiven)}
          sub="vs full shelf price"
          icon={<TrendingDown size={18} />}
          accent="rose"
        />
        <StatCard
          label="Never sold"
          value={num(totals.neverSold)}
          sub="finished without a sale"
          icon={<CircleSlash size={18} />}
          accent="amber"
        />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Last selling day from</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div>
            <label className="label">Status</label>
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: "All", label: "Every label" },
                { value: "Active", label: "Running now" },
                { value: "Scheduled", label: "Starts later" },
                { value: "Expired", label: "Finished" },
                { value: "Cancelled", label: "Pulled early" },
              ]}
            />
          </div>
          <div>
            <label className="label">Search</label>
            <input
              className="input"
              placeholder="Product, item ID, label…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <a href={exportHref("xlsx")} className="btn-ghost !py-2 text-sm">
            <FileSpreadsheet size={15} /> Excel
          </a>
          <a href={exportHref("pdf")} className="btn-ghost !py-2 text-sm">
            <FileType2 size={15} /> PDF
          </a>
          <a href={exportHref("csv")} className="btn-ghost !py-2 text-sm">
            <FileDown size={15} /> CSV
          </a>
        </div>
      </Card>

      {loading ? (
        <Spinner label="Loading mark downs…" />
      ) : (
        <Card subtitle="A label with no sales isn't missing data — it means the cut didn't shift the stock.">
          {rows.length === 0 ? (
            <EmptyState
              title="No mark down in this window"
              hint="Labels appear here once they've run — change the dates above to look further back."
              icon={<TicketPercent size={18} />}
            />
          ) : (
            // Nine columns with no gutter run into each other — the cut price
            // and the dates beside it touch. Scoped here rather than added to
            // the shared Table, which every other report already lines up with.
            <Table className="[&_td]:pr-4 [&_th]:pr-4 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
              <THead>
                <Th>Product</Th>
                <Th>Status</Th>
                <Th align="right">Cut</Th>
                <Th align="right">Price</Th>
                <Th>Ran</Th>
                <Th align="right">Sold</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Discount given</Th>
                {showProfit && <Th align="right">Profit</Th>}
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-semibold text-ink-900">{r.name}</span>
                      <span className="block text-[11.5px] text-slate-400">
                        <span className="font-mono">{r.code}</span> · {r.sku}
                        {r.category ? ` · ${r.category}` : ""}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    </Td>
                    <Td align="right" className="font-semibold text-amber-600">
                      -{r.percent}%
                    </Td>
                    <Td align="right">
                      <span className="font-semibold text-amber-700">{usd(r.price)}</span>
                      <span className="block text-[11px] text-slate-400 line-through">{usd(r.originalPrice)}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px] text-slate-500">
                      {shortDay(r.startDate)} → {shortDay(r.endDate)}
                    </Td>
                    <Td align="right" className="font-bold text-ink-900">
                      {r.qtySold === 0 ? <span className="text-slate-300">0</span> : num(r.qtySold)}
                    </Td>
                    <Td align="right" className="font-semibold text-emerald-600">
                      {usd(r.revenue)}
                    </Td>
                    <Td align="right" className="font-semibold text-rose-600">
                      {usd(r.discountGiven)}
                    </Td>
                    {showProfit && (
                      <Td align="right" className={r.profit < 0 ? "font-semibold text-rose-600" : "font-semibold text-ink-900"}>
                        {usd(r.profit)}
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
