"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SearchSelectOption = { value: string; label: string; hint?: string };

// A searchable dropdown to replace long native <select> lists (categories,
// suppliers…). Type in the panel to filter; click to pick.
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className = "",
}: {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      // Focus the filter box as soon as the panel opens.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return options.slice(0, 200);
    return options
      .filter((o) => o.label.toLowerCase().includes(query) || (o.hint || "").toLowerCase().includes(query))
      .slice(0, 200);
  }, [options, q]);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left ${open ? "border-brand-500 ring-4 ring-brand-500/10" : ""}`}
      >
        <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-slate-400"}`}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1 animate-fade-up overflow-hidden rounded-xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
            <div className="relative border-b border-slate-100 p-2">
              <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-[13px] text-ink-800 outline-none placeholder:text-slate-400"
                placeholder="Type to search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && filtered.length > 0) {
                    onChange(filtered[0].value);
                    setOpen(false);
                  }
                }}
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3.5 py-3 text-[13px] text-slate-400">No matches</p>
              ) : (
                filtered.map((o) => {
                  const active = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition ${
                        active ? "bg-brand-50/70 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 text-[11px] text-slate-400">{o.hint}</span>}
                      {active && <Check size={14} className="shrink-0 text-brand-600" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
