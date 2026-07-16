"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

// A small, on-brand date picker that replaces the browser-native <input type="date">
// calendar (which can't be themed). Value/onChange use "yyyy-mm-dd" so it's a
// drop-in for the string date state used across the app. Min/max bound the
// selectable range (inclusive), also as "yyyy-mm-dd".

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, mo: number, d: number) => `${y}-${pad(mo + 1)}-${pad(d)}`;

function parse(v?: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3] };
}

function label(v?: string): string {
  const p = parse(v);
  if (!p) return "Select date";
  return `${p.d} ${MONTHS_SHORT[p.mo]} ${p.y}`;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  className,
  allowClear,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  className?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // The calendar hangs off document.body rather than out of this wrapper: inside
  // a dialog it would otherwise be cut off by the body's overflow-y-auto (and no
  // z-index can escape a clip), leaving the picker unusable in every modal that
  // has one. Fixed coords are measured off the trigger instead.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const now = new Date();
  const parsed = parse(value);
  const [viewY, setViewY] = useState(parsed?.y ?? now.getFullYear());
  const [viewMo, setViewMo] = useState(parsed?.mo ?? now.getMonth());

  // When opening, jump the calendar to the selected month (or today).
  useEffect(() => {
    if (!open) return;
    const p = parse(value);
    setViewY(p?.y ?? now.getFullYear());
    setViewMo(p?.mo ?? now.getMonth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Place the calendar against the viewport: under the button, flipped above
  // when the bottom of the screen is close (a date field low in a dialog, or on
  // a phone), and never off the left/right edge.
  const GAP = 8;
  function place() {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const pw = popRef.current?.offsetWidth || 288;
    const ph = popRef.current?.offsetHeight || 320;
    let top = b.bottom + GAP;
    if (top + ph > window.innerHeight - GAP) {
      const above = b.top - ph - GAP;
      // Prefer above; if it doesn't fit either way, sit it against the bottom.
      top = above >= GAP ? above : Math.max(GAP, window.innerHeight - ph - GAP);
    }
    const left = Math.max(GAP, Math.min(b.left, window.innerWidth - pw - GAP));
    setPos({ top, left });
  }

  // After it mounts its real size is known, so re-place with the true height —
  // that's what makes the flip-above decision correct rather than a guess.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true); // capture: any scrolling ancestor
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewY, viewMo]);

  // Close on outside click or Escape. The calendar is no longer inside the
  // wrapper, so a click in it has to be checked separately or picking a date
  // would close the picker before it registered.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const startWd = new Date(viewY, viewMo, 1).getDay();
    const daysInMonth = new Date(viewY, viewMo + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < startWd; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [viewY, viewMo]);

  const shift = (delta: number) => {
    let m = viewMo + delta;
    let y = viewY;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMo(m);
    setViewY(y);
  };

  const isDisabled = (d: number) => {
    const k = keyOf(viewY, viewMo, d);
    if (min && k < min) return true;
    if (max && k > max) return true;
    return false;
  };

  const todayKey = keyOf(now.getFullYear(), now.getMonth(), now.getDate());
  const select = (k: string) => {
    onChange(k);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          const next = !open;
          // Seed a position from the trigger before it paints, so the calendar
          // never flashes at the wrong spot on its first frame. Both setters are
          // called from the handler, never from inside an updater — React runs
          // updaters during render, and setting other state there is illegal.
          if (next && btnRef.current) {
            const b = btnRef.current.getBoundingClientRect();
            setPos({ top: b.bottom + GAP, left: b.left });
          }
          setOpen(next);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-ink-800 outline-none transition hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      >
        <CalendarIcon size={15} className="text-slate-400" />
        <span className={parsed ? "" : "text-slate-400"}>{label(value)}</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className="z-[80] w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lift"
        >
          {/* Month header + navigation */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <p className="text-sm font-bold text-ink-900">
              {MONTHS[viewMo]} {viewY}
            </p>
            <button
              type="button"
              onClick={() => shift(1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday row */}
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const k = keyOf(viewY, viewMo, d);
              const selected = k === value;
              const isToday = k === todayKey;
              const disabled = isDisabled(d);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => select(k)}
                  className={`grid h-8 w-full place-items-center rounded-lg text-sm transition ${
                    selected
                      ? "bg-brand-500 font-bold text-white"
                      : disabled
                        ? "cursor-not-allowed text-slate-300"
                        : isToday
                          ? "font-semibold text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                          : "text-ink-700 hover:bg-slate-100"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs font-semibold">
            {allowClear ? (
              <button type="button" onClick={() => select("")} className="text-slate-500 hover:text-slate-700">
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => select(todayKey)}
              disabled={(min && todayKey < min) || (max && todayKey > max) || false}
              className="text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Today
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
