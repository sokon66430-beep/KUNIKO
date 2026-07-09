"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  Truck,
  Barcode,
  History,
  BarChart3 as ReportIcon,
  Settings,
  Building2,
  LogOut,
  ChevronsUpDown,
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
    { href: "/purchase-requests", label: "Purchase Requests", icon: FileText },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/reports", label: "Reports", icon: BarChart3 },
  ],
};
const PROCUREMENT = {
  label: "Procurement",
  items: [
    { href: "/products", label: "Products", icon: Barcode },
    { href: "/suppliers", label: "Suppliers", icon: Truck },
    { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
    { href: "/receiving", label: "Receiving", icon: PackageCheck },
    { href: "/procurement-reports", label: "Reports", icon: ReportIcon },
    { href: "/audit", label: "Audit Trail", icon: History },
  ],
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSession)
      .catch(() => {});
  }, []);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const isOwner = session?.user.role === "owner";

  const admin = {
    label: "Management",
    items: [
      ...(isOwner ? [{ href: "/stores", label: "Stores & Users", icon: Building2 }] : []),
      { href: "/settings", label: "Store Settings", icon: Settings },
    ],
  };
  const groups = [OPERATIONS, PROCUREMENT, admin];

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
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-3 px-5 pb-4 pt-6">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-brand-glow">
          <span className="text-[17px] font-black leading-none tracking-tight">S</span>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-none tracking-tight text-ink-900">Stookii</p>
          <p className="mt-1 truncate text-[11px] font-medium text-slate-400">
            {session?.user.storeName || "Retail Ordering"}
          </p>
        </div>
      </div>

      {/* Store switcher (owners with >1 store) */}
      {isOwner && (session?.stores.length || 0) > 1 && (
        <div className="px-3 pb-1">
          <div className="relative">
            <select
              value={session!.user.storeId}
              disabled={switching}
              onChange={(e) => switchStore(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs font-semibold text-ink-800 outline-none focus:border-brand-400"
            >
              {session!.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="mb-1 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
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
                    active
                      ? "bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-100"
                      : "font-medium text-slate-500 hover:bg-slate-100/70 hover:text-ink-800"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-600" />
                  )}
                  <Icon size={18} strokeWidth={active ? 2.5 : 2} className={active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-slate-100 px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
            {(session?.user.name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-800">{session?.user.name || "—"}</p>
            <p className="text-[11px] capitalize text-slate-400">{session?.user.role || ""}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <span className="text-[15px] font-black leading-none tracking-tight">S</span>
          </div>
          <span className="font-bold tracking-tight">Stookii</span>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <Menu size={22} />
        </button>
      </div>

      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[264px] border-r border-slate-200 bg-white lg:block">
        {content}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[264px] border-r border-slate-200 bg-white">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-5 z-10 rounded-lg p-2 text-slate-400 hover:bg-slate-100"
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
