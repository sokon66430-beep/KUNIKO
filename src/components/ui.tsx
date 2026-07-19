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
    <div className="stat card p-4 transition-colors duration-200 hover:ring-slate-300 sm:p-6">
      {/* Fixed header height so the VALUES line up across a row.
          It used to be max(label, icon): a one-line label gave 32px, two lines
          34, three 51 — so one long label dropped its number below its
          neighbours' and the row stopped reading as a straight line. Now the
          header is always h-9 and the label is clamped to two lines inside it,
          so a number sits at the same height whatever it's called. */}
      <div className="flex h-9 items-start justify-between gap-2">
        <p className="line-clamp-2 text-[11px] font-bold uppercase leading-tight tracking-[0.08em] text-slate-500 sm:text-[11.5px] sm:tracking-[0.1em]">
          {label}
        </p>
        {icon && (
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${accents[accent]}`}>{icon}</div>
        )}
      </div>
      {/* Sized against the card (see `.stat`), not the viewport: `cqi` is a
          percentage of this card's own width, so a number gets big when the
          card is wide and steps back when the row is crowded. The old `4.2vw`
          asked the screen instead, which is why $50,263.32 in a 5-up row was
          drawn at 32px in 167px of space and ran into its own padding.
          Floor keeps it legible on a 2-up phone; cap stops a lone wide card
          from turning $7.00 into a billboard. */}
      <p className="mt-3 whitespace-nowrap text-[clamp(1.05rem,14cqi,1.75rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink-900 sm:mt-5">
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
  // `muted` is for a state that's normal-but-notable. Reach for it when a badge
  // appears on most rows: a colour every row shares stops being a signal, and
  // spending red on the common case leaves nothing louder for the rare one.
  tone?: "slate" | "muted" | "emerald" | "amber" | "rose" | "brand" | "violet" | "gold";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    muted: "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
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

/**
 * The "nothing here" state.
 *
 * An icon and an action, not just grey text in a void: an empty screen is the
 * first thing a new user sees, and it should tell them what to do next rather
 * than look broken. Both are optional, so existing calls keep working.
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">{icon}</div>
      )}
      <div>
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table primitives
//
// Every list screen used to hand-roll its own <table> markup, which is why some
// carried column headers and others didn't, and why numbers lined up on one
// page and not the next. One set of parts, so a table is consistent by default
// rather than by whoever wrote it remembering.
//
// `align="right"` also switches on tabular figures: proportional digits make a
// column of prices jitter, and a jittering column is hard to compare down.
// ---------------------------------------------------------------------------

type Align = "left" | "right" | "center";

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right tabular-nums",
  center: "text-center",
};

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Wrapped so a wide table scrolls inside its own card instead of pushing the
  // whole page sideways on a phone.
  return (
    <div className={`-mx-1 overflow-x-auto px-1 ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-slate-200">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap pb-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 ${ALIGN[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-slate-100 last:border-0 ${
        onClick ? "cursor-pointer transition-colors hover:bg-slate-50" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
  colSpan?: number;
}) {
  return <td colSpan={colSpan} className={`py-2.5 ${ALIGN[align]} ${className}`}>{children}</td>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl" | "2xl";
}) {
  if (!open) return null;
  const maxW =
    size === "2xl" ? "max-w-5xl" : size === "xl" ? "max-w-3xl" : size === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[4px]" onClick={onClose} />
      <div
        className={`relative z-10 w-full ${maxW} animate-fade-up overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold tracking-[-0.01em] text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={17} />
          </button>
        </div>
        <div className={`overflow-y-auto px-6 py-5 ${size === "xl" || size === "2xl" ? "max-h-[80vh]" : "max-h-[70vh]"}`}>
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
