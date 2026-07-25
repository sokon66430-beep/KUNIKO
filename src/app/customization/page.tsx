"use client";

import { useState } from "react";
import { LayoutGrid, ReceiptText, Monitor } from "lucide-react";
import { useRole } from "@/lib/client";
import MenuLayoutPage from "@/app/menu-layout/page";
import InvoiceSettingsPage from "@/app/invoice-settings/page";
import CustomerScreenSettingsPage from "@/app/customer-display-settings/page";

// One "Customization" hub that gathers the three ways to tailor the app —
// Menu Layout, the printed Invoice, and the Customer Screen — under a single
// menu item with tabs, instead of three separate sidebar entries. Each tab is
// the full existing tool (with its own Save), so nothing about how they work
// changes; they just live together now.
//
// Menu Layout reorders EVERY role's sidebar, so it stays owner-only — the tab
// only appears for the owner.

const ALL_TABS = [
  { key: "menu", label: "Menu Layout", icon: LayoutGrid, Comp: MenuLayoutPage, ownerOnly: true },
  { key: "invoice", label: "Invoice", icon: ReceiptText, Comp: InvoiceSettingsPage, ownerOnly: false },
  { key: "screen", label: "Customer Screen", icon: Monitor, Comp: CustomerScreenSettingsPage, ownerOnly: false },
] as const;

export default function CustomizationPage() {
  const role = useRole();
  const tabs = ALL_TABS.filter((t) => !t.ownerOnly || role === "owner");
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "invoice");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const Active = current?.Comp ?? InvoiceSettingsPage;

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = t.key === current?.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                on ? "bg-white text-ink-900 shadow-soft" : "text-slate-500 hover:text-ink-800"
              }`}
            >
              <Icon size={16} className={on ? "text-brand-600" : "text-slate-400"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* The chosen tool renders in full — its own header and Save live here. */}
      <Active />
    </div>
  );
}
