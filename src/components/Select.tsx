"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; description?: string };

// A small, on-brand dropdown that replaces the browser-native <select> (whose
// option list can't be themed). For short option lists — no search box. Supports
// an optional one-line description per option. value/onChange are plain strings,
// so it's a drop-in for the string state behind a native <select>.
//
// The option panel renders in a portal on document.body with fixed positioning
// anchored to the trigger, so it's never clipped when used inside a modal or any
// scroll/overflow-hidden container. It follows the trigger on scroll/resize.
export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className = "",
  buttonClassName = "",
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => setMounted(true), []);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (b) setRect({ top: b.bottom + 4, left: b.left, width: b.width });
  };
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture-phase scroll so the panel tracks the trigger even when an inner
    // container (e.g. a modal body) scrolls, not just the window.
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panel =
    open && rect && mounted
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 100 }}
            className="animate-fade-up overflow-hidden rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]"
          >
            <div className="max-h-72 overflow-y-auto py-1">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2 px-3.5 py-2 text-left transition ${
                      active ? "bg-brand-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${active ? "font-semibold text-brand-700" : "text-ink-800"}`}>
                        {o.label}
                      </span>
                      {o.description && (
                        <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">{o.description}</span>
                      )}
                    </span>
                    {active && <Check size={15} className="mt-0.5 shrink-0 text-brand-600" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
          open ? "border-brand-500 ring-4 ring-brand-500/10" : ""
        } ${buttonClassName}`}
      >
        <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-slate-400"}`}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {panel}
    </div>
  );
}

/**
 * The same dropdown, but you can tick more than one.
 *
 * Separate from `Select` rather than a `multi` flag on it: the two differ in
 * what a click MEANS. In a single select, choosing is also dismissing — so the
 * panel closes. Here a click is a toggle and the panel has to stay open, or
 * picking three stores means opening the list three times, which is the thing
 * this exists to avoid.
 *
 * `allLabel` renders a first row that means "everything". Ticking it clears the
 * list rather than selecting every id, so an empty selection is unambiguous:
 * empty = all. That also keeps "all" meaning all — including a store added
 * later, which an exploded list of today's ids would silently miss.
 */
export function MultiSelect({
  values,
  options,
  onChange,
  allLabel,
  placeholder = "Select…",
  className = "",
  buttonClassName = "",
  disabled = false,
}: {
  values: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (b) setRect({ top: b.bottom + 4, left: b.left, width: b.width });
  };
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = values.length === 0;
  const chosen = options.filter((o) => values.includes(o.value));
  // Name them while they fit, then count. "ON Mart TK st.592, ON Mart PDK" says
  // more at a glance than "2 selected", but four names in a 180px button says
  // nothing at all.
  const summary = all
    ? allLabel || placeholder
    : chosen.length <= 2
      ? chosen.map((o) => o.label).join(", ")
      : `${chosen.length} of ${options.length} stores`;

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  const row = (key: string, label: string, active: boolean, onClick: () => void, divider = false) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition ${
        divider ? "border-b border-slate-100" : ""
      } ${active ? "bg-brand-50/70" : "hover:bg-slate-50"}`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
          active ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300"
        }`}
      >
        {active && <Check size={11} />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-semibold text-brand-700" : "text-ink-800"}`}>
        {label}
      </span>
    </button>
  );

  const panel =
    open && rect && mounted
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 100 }}
            className="animate-fade-up overflow-hidden rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]"
          >
            <div className="max-h-72 overflow-y-auto py-1">
              {allLabel && row("__all", allLabel, all, () => onChange([]), true)}
              {options.map((o) => row(o.value, o.label, values.includes(o.value), () => toggle(o.value)))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
          open ? "border-brand-500 ring-4 ring-brand-500/10" : ""
        } ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {panel}
    </div>
  );
}
