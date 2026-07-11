"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canAccessPage } from "@/lib/access";
import { useTheme } from "@/components/theme";
import { NotificationBell } from "@/components/NotificationBell";
import type { Role } from "@/lib/auth";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Menu,
  X,
  FileText,
  ClipboardList,
  ClipboardCheck,
  PackageCheck,
  PackageX,
  Truck,
  Barcode,
  History,
  Settings,
  Building2,
  LayoutGrid,
  LogOut,
  ChevronsUpDown,
  Check,
  Store,
  Tag,
  ReceiptText,
} from "lucide-react";

type SessionInfo = {
  user: { name: string; role: string; storeId: string; storeName: string };
  stores: { id: string; name: string }[];
};

const OPERATIONS = {
  label: "Operations",
  items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/pos", label: "Point of Sale", icon: ShoppingCart },
    { href: "/inventory", label: "Inventory", icon: Package },
    { href: "/stock-count", label: "Stock Count", icon: ClipboardCheck },
    { href: "/write-offs", label: "Write-Off", icon: PackageX },
    { href: "/price-labels", label: "Price Labels", icon: Tag },
    { href: "/purchase-requests", label: "Purchase Requests", icon: FileText },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/reports-center", label: "Reports", icon: BarChart3 },
  ],
};
const PROCUREMENT = {
  label: "Procurement",
  items: [
    { href: "/products", label: "Products", icon: Barcode },
    { href: "/suppliers", label: "Suppliers", icon: Truck },
    { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
    { href: "/receiving", label: "Receiving", icon: PackageCheck },
    { href: "/audit", label: "Audit Trail", icon: History },
  ],
};
const ACCOUNTING = {
  label: "Accounting",
  items: [{ href: "/invoices", label: "Invoices", icon: ReceiptText }],
};

// Two full palettes for the navigation chrome. Light is the default (clean white
// rail); dark is the optional ink theme. Everything else in the app stays light.
function palette(dark: boolean, switcherOpen: boolean) {
  return dark
    ? {
        surface: "bg-ink-900",
        divider: "border-white/10",
        brandTitle: "text-white",
        storeSub: "text-slate-400",
        groupLabel: "text-slate-500",
        navIdle: "font-medium text-slate-400 hover:bg-white/5 hover:text-white",
        navIdleIcon: "text-slate-500 group-hover:text-slate-300",
        navActive: "bg-brand-600 font-bold text-white shadow-brand-glow",
        navActiveIcon: "text-white",
        switcherBtn: switcherOpen
          ? "bg-white/10 ring-white/20"
          : "bg-white/5 ring-white/10 hover:bg-white/10 hover:ring-white/20",
        switcherIconWrap: "bg-brand-500/20 text-brand-300",
        switcherLabel: "text-slate-500",
        switcherName: "text-white",
        switcherChevron: "text-slate-500",
        userAvatar: "bg-brand-500/25 text-brand-200",
        userName: "text-white",
        userRole: "text-slate-500",
        logout: "text-slate-500 hover:bg-rose-500/15 hover:text-rose-400",
        toggleTrack: "bg-white/5 ring-white/10",
        toggleActive: "bg-white/15 text-white shadow-sm",
        toggleIdle: "text-slate-400 hover:text-white",
      }
    : {
        surface: "bg-white ring-1 ring-slate-200/80",
        divider: "border-slate-200/80",
        brandTitle: "text-ink-900",
        storeSub: "text-slate-500",
        groupLabel: "text-slate-400",
        navIdle: "font-medium text-slate-600 hover:bg-slate-100 hover:text-ink-900",
        navIdleIcon: "text-slate-400 group-hover:text-slate-600",
        navActive: "bg-brand-50 font-bold text-brand-700 ring-1 ring-brand-100",
        navActiveIcon: "text-brand-600",
        switcherBtn: switcherOpen
          ? "bg-slate-100 ring-slate-300"
          : "bg-slate-50 ring-slate-200 hover:bg-slate-100 hover:ring-slate-300",
        switcherIconWrap: "bg-brand-50 text-brand-600",
        switcherLabel: "text-slate-400",
        switcherName: "text-ink-900",
        switcherChevron: "text-slate-400",
        userAvatar: "bg-brand-50 text-brand-600",
        userName: "text-ink-900",
        userRole: "text-slate-400",
        logout: "text-slate-400 hover:bg-rose-50 hover:text-rose-600",
        toggleTrack: "bg-slate-100 ring-slate-200",
        toggleActive: "bg-white text-ink-900 shadow-sm",
        toggleIdle: "text-slate-400 hover:text-slate-600",
      };
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [switching, setSwitching] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSession)
      .catch(() => {});
  }, []);

  const dark = theme === "dark";
  const t = palette(dark, storeMenuOpen);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const isOwner = session?.user.role === "owner";
  // Owner can switch between and manage every store.
  const ALLOW_STORE_SWITCH = true;

  const role = (session?.user.role || "operations") as Role;
  const admin = {
    label: "Management",
    items: [
      { href: "/all-stores", label: "All Stores", icon: LayoutGrid },
      { href: "/stores", label: "Stores & Employees", icon: Building2 },
      { href: "/settings", label: "Store Settings", icon: Settings },
    ],
  };
  // Show only the menus this role may use (Accountant is limited; others see all).
  const groups = [OPERATIONS, PROCUREMENT, ACCOUNTING, admin]
    .map((g) => ({ ...g, items: g.items.filter((it) => canAccessPage(role, it.href)) }))
    .filter((g) => g.items.length > 0);

  async function switchStore(storeId: string) {
    if (storeId === session?.user.storeId) return;
    setSwitching(true);
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    window.location.href = "/"; // full reload so every page refetches the new store
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const content = (
    <div className={`flex h-full flex-col ${t.surface}`}>
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-brand-glow">
          <span className="text-[17px] font-black leading-none tracking-tight">S</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[15.5px] font-extrabold leading-none tracking-tight ${t.brandTitle}`}>Stookii</p>
          <p className={`mt-1.5 truncate text-[11px] font-medium ${t.storeSub}`}>
            {session?.user.storeName || "Retail Ordering"}
          </p>
        </div>
        <NotificationBell align="left" />
      </div>

      {/* Store switcher (owner) — switch the active store, or add more. */}
      {ALLOW_STORE_SWITCH && isOwner && (session?.stores.length || 0) >= 1 && (
        <div className="relative px-3 pb-1">
          <button
            type="button"
            disabled={switching}
            onClick={() => setStoreMenuOpen((v) => !v)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 transition ${t.switcherBtn}`}
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${t.switcherIconWrap}`}>
              <Store size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[10px] font-semibold uppercase tracking-[0.08em] ${t.switcherLabel}`}>
                Current store
              </span>
              <span className={`block truncate text-[12.5px] font-semibold ${t.switcherName}`}>
                {switching ? "Switching…" : session!.user.storeName}
              </span>
            </span>
            <ChevronsUpDown size={14} className={`shrink-0 ${t.switcherChevron}`} />
          </button>

          {storeMenuOpen && (
            <>
              {/* click-away */}
              <div className="fixed inset-0 z-40" onClick={() => setStoreMenuOpen(false)} />
              <div className="absolute left-3 right-3 z-50 mt-1.5 animate-fade-up overflow-hidden rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
                <p className="border-b border-slate-100 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {session!.stores.length > 1 ? "Switch store" : "Your store"}
                </p>
                {session!.stores.map((s) => {
                  const active = s.id === session!.user.storeId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setStoreMenuOpen(false);
                        switchStore(s.id);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition ${
                        active ? "bg-brand-50/70 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                          active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        <Store size={13} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {active && <Check size={15} className="shrink-0 text-brand-600" />}
                    </button>
                  );
                })}
                <Link
                  href="/stores"
                  onClick={() => setStoreMenuOpen(false)}
                  className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3.5 py-2.5 text-left text-[13px] font-semibold text-brand-600 transition hover:bg-brand-50/60"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
                    <Building2 size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">Add / manage stores</span>
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className={`mb-1.5 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] ${t.groupLabel}`}>
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-all ${
                    active ? t.navActive : t.navIdle
                  }`}
                >
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.5 : 2}
                    className={active ? t.navActiveIcon : t.navIdleIcon}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className={`border-t ${t.divider} px-3 py-3`}>
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${t.userAvatar}`}>
            {(session?.user.name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${t.userName}`}>{session?.user.name || "—"}</p>
            <p className={`text-[11px] capitalize ${t.userRole}`}>{session?.user.role || ""}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className={`grid h-8 w-8 place-items-center rounded-lg ${t.logout}`}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-4 py-3 backdrop-blur lg:hidden ${
          dark ? "border-white/10 bg-ink-900/95" : "border-slate-200 bg-white/95"
        }`}
      >
        <button
          onClick={() => setOpen(true)}
          className={`rounded-lg p-2 ${
            dark ? "text-slate-300 hover:bg-white/10 hover:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-ink-900"
          }`}
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2.5">
          <NotificationBell />
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <span className="text-[15px] font-black leading-none tracking-tight">S</span>
          </div>
          <span className={`font-extrabold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>Stookii</span>
        </div>
      </div>

      <aside className={`fixed left-0 top-0 z-30 hidden h-screen w-[264px] lg:block ${t.surface}`}>{content}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className={`absolute left-0 top-0 h-full w-[264px] shadow-lift ${t.surface}`}>
            <button
              onClick={() => setOpen(false)}
              className={`absolute right-3 top-5 z-10 rounded-lg p-2 ${
                dark ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-ink-900"
              }`}
            >
              <X size={20} />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
