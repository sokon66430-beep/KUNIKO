"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  FileText,
  PackageCheck,
  PackageX,
  ClipboardCheck,
  ArrowRight,
  FileSpreadsheet,
  FileType2,
  FileDown,
  ChefHat,
  Sparkles,
  Boxes,
  TicketPercent,
} from "lucide-react";
import { useFetch } from "@/lib/client";
import type {
  Sale,
  PurchaseOrder,
  PurchaseRequest,
  GoodsReceipt,
  WriteOff,
  StockCount,
  Recipe,
  Promotion,
  Product,
  Markdown,
} from "@/lib/types";
import { PageHeader, Card } from "@/components/ui";
import { SearchSelect } from "@/components/SearchSelect";
import { num } from "@/lib/format";

type Accent = "brand" | "violet" | "emerald" | "amber" | "rose" | "slate";
const TINT: Record<Accent, string> = {
  brand: "bg-brand-50 text-brand-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
};

// Every report offers the same three downloads. `base` already carries any
// query (?), so we append format params with the right separator.
function exportsFor(base: string) {
  const sep = base.includes("?") ? "&" : "?";
  return [
    { label: "Excel", href: base, icon: FileSpreadsheet },
    { label: "PDF", href: `${base}${sep}format=pdf`, icon: FileType2 },
    { label: "CSV", href: `${base}${sep}format=csv`, icon: FileDown },
  ];
}

export default function ReportsCenterPage() {
  const { data: sales } = useFetch<Sale[]>("/api/sales?limit=100000");
  const { data: pos } = useFetch<PurchaseOrder[]>("/api/purchase-orders");
  const { data: prs } = useFetch<PurchaseRequest[]>("/api/purchase-requests");
  const { data: grns } = useFetch<GoodsReceipt[]>("/api/goods-receipts");
  const { data: wos } = useFetch<WriteOff[]>("/api/write-offs");
  const { data: counts } = useFetch<StockCount[]>("/api/stock-counts");
  const { data: recipes } = useFetch<Recipe[]>("/api/recipes");
  const { data: promotions } = useFetch<Promotion[]>("/api/promotions");
  const { data: markdowns } = useFetch<Markdown[]>("/api/markdowns");
  const { data: products } = useFetch<Product[]>("/api/products");

  // Receiving report can be narrowed to one supplier.
  const [grnSupplier, setGrnSupplier] = useState("All");
  const grnSuppliers = useMemo(
    () => Array.from(new Set((grns || []).map((g) => g.supplier).filter(Boolean))).sort(),
    [grns],
  );
  const grnBase =
    grnSupplier === "All"
      ? "/api/reports/goods-receipts/export"
      : `/api/reports/goods-receipts/export?supplier=${encodeURIComponent(grnSupplier)}`;

  const cards: {
    icon: any;
    accent: Accent;
    title: string;
    desc: string;
    stat?: string;
    open?: string;
    exports?: { label: string; href: string; icon: any }[];
    filterNode?: React.ReactNode;
  }[] = [
    {
      icon: BarChart3,
      accent: "brand",
      title: "Sales & Profit",
      desc: "Revenue, profit, margin and best-selling products over any period.",
      stat: sales ? `${num(sales.length)} sales` : undefined,
      open: "/reports",
      exports: exportsFor("/api/reports/sales/export"),
    },
    {
      icon: ClipboardList,
      accent: "violet",
      title: "Purchase Orders",
      desc: "PO activity, value ordered vs received, and outstanding amounts by supplier.",
      stat: pos ? `${num(pos.length)} orders` : undefined,
      open: "/procurement-reports",
      exports: exportsFor("/api/reports/purchase-orders/export"),
    },
    {
      icon: FileText,
      accent: "brand",
      title: "Purchase Requests",
      desc: "Requests raised, approved, ordered or rejected — with estimated value.",
      stat: prs ? `${num(prs.length)} requests` : undefined,
      open: "/procurement-reports",
      exports: exportsFor("/api/reports/purchase-requests/export"),
    },
    {
      icon: PackageCheck,
      accent: "emerald",
      title: "Goods Receiving",
      desc: "What was received, when, by whom — item cost detail and total, filterable by supplier.",
      stat: grns ? `${num(grns.length)} receipts` : undefined,
      open: "/receiving",
      exports: exportsFor(grnBase),
      filterNode: (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Supplier
          </span>
          <SearchSelect
            value={grnSupplier}
            onChange={setGrnSupplier}
            options={[{ value: "All", label: "All suppliers" }, ...grnSuppliers.map((s) => ({ value: s, label: s }))]}
          />
        </label>
      ),
    },
    {
      icon: PackageX,
      accent: "rose",
      title: "Write-Offs",
      desc: "Damaged, expired and missing stock — broken down by reason and category.",
      stat: wos ? `${num(wos.length)} records` : undefined,
      open: "/write-off-reports",
      exports: exportsFor("/api/write-offs/export"),
    },
    {
      icon: ChefHat,
      accent: "violet",
      title: "Recipes",
      desc: "Ingredients the kitchen consumed, bowls sold per recipe, and food cost vs margin.",
      stat: recipes ? `${num(recipes.length)} recipes` : undefined,
      open: "/recipe-reports",
    },
    {
      icon: Sparkles,
      accent: "emerald",
      title: "Promotions",
      desc: "How each deal performed — times used, items given free, discount cost and sales generated.",
      stat: promotions ? `${num(promotions.length)} promotions` : undefined,
      open: "/promotion-reports",
    },
    {
      icon: TicketPercent,
      accent: "amber",
      title: "Mark Downs",
      desc: "Every reduced-to-clear label — what it shifted, what the discount cost, and which never sold.",
      stat: markdowns ? `${num(markdowns.length)} labels` : undefined,
      open: "/markdown-reports",
      exports: exportsFor("/api/reports/markdowns/export"),
    },
    {
      icon: Boxes,
      accent: "violet",
      title: "Selling Units",
      desc: "What sold in each packaging — cases, packs and singles — and what the shelf holds in each.",
      stat: products ? `${num(products.filter((p) => (p.sellingUnits || []).length).length)} with packaging` : undefined,
      open: "/unit-sales",
    },
    {
      icon: ClipboardCheck,
      accent: "amber",
      title: "Stock Counts",
      desc: "Physical stocktakes and variances vs system stock, with a downloadable sheet.",
      stat: counts ? `${num(counts.length)} counts` : undefined,
      open: "/stock-count",
      exports: exportsFor("/api/reports/stock-counts/export"),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Every report in one place — open the full view or download as Excel, PDF or CSV"
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title} className="flex flex-col p-5">
            <div className="flex items-start justify-between">
              <div className={`grid h-11 w-11 place-items-center rounded-xl ${TINT[c.accent]}`}>
                <c.icon size={20} />
              </div>
              {c.stat && <span className="text-xs font-semibold text-slate-400">{c.stat}</span>}
            </div>
            <h3 className="mt-4 text-base font-bold text-ink-900">{c.title}</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-500">{c.desc}</p>

            {c.filterNode}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {c.open && (
                <Link href={c.open} className="btn-primary !py-2 text-sm">
                  Open <ArrowRight size={15} />
                </Link>
              )}
              {c.exports?.map((e) => (
                <a key={e.label} href={e.href} className="btn-ghost !py-2 text-sm">
                  <e.icon size={15} /> {e.label}
                </a>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
