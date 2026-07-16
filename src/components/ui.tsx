"use client";

import { ReactNode } from "react";
import { Loader2, X } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 sm:mb-8">
      <div>
        <h1 className="text-xl font-extrabold leading-tight tracking-[-0.03em] text-ink-900 sm:text-[28px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 sm:mt-2 sm:text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  subtitle,
  icon,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      {(title || icon) && (
        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm font-bold text-ink-900">
            {icon}
            {title}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "brand",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: "brand" | "emerald" | "amber" | "violet" | "rose";
}) {
  const accents: Record<string, string> = {
    brand: "bg-brand-50 text-brand-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    violet: "bg-violet-50 text-violet-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="card p-4 transition-colors duration-200 hover:ring-slate-300 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[11.5px] sm:tracking-[0.1em]">
          {label}
        </p>
        {icon && (
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${accents[accent]}`}>{icon}</div>
        )}
      </div>
      {/* Fluid size: scales down on narrow phones so long amounts (e.g.
          $50,579.43) never clip in a 2-up grid, and caps at 32px on desktop. */}
      <p className="mt-3 whitespace-nowrap text-[clamp(1.05rem,4.2vw,2rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink-900 sm:mt-5">
        {value}
      </p>
      {sub && <p className="mt-2 text-[12px] text-slate-400 sm:mt-2.5 sm:text-[13px]">{sub}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "emerald" | "amber" | "rose" | "brand" | "violet" | "gold";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    brand: "bg-brand-100 text-brand-700",
    violet: "bg-violet-100 text-violet-700",
    gold: "bg-yellow-100 text-yellow-700",
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 className="animate-spin" size={20} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[4px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg animate-fade-up overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold tracking-[-0.01em] text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={17} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
