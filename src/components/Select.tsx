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
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
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
        onClick={() => setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left ${open ? "border-brand-500 ring-4 ring-brand-500/10" : ""}`}
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
