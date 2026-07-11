"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "brand";
};

// Module-level bridge so any file can call confirmDialog() without a hook.
// ConfirmHost (mounted once in the layout) registers the opener; if it's not
// mounted yet we fall back to the native confirm so nothing ever breaks.
let opener: ((opts: ConfirmOptions) => void) | null = null;
let resolver: ((value: boolean) => void) | null = null;

export function confirmDialog(input: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof input === "string" ? { message: input } : input;
  if (!opener) return Promise.resolve(window.confirm(opts.message));
  return new Promise((resolve) => {
    resolver = resolve;
    opener!(opts);
  });
}

export function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  useEffect(() => {
    opener = (o) => setOpts(o);
    return () => {
      opener = null;
    };
  }, []);

  const close = useCallback((value: boolean) => {
    setOpts(null);
    resolver?.(value);
    resolver = null;
  }, []);

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  if (!opts) return null;

  const danger = opts.tone !== "brand";
  const Icon = danger ? AlertTriangle : Info;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/45 backdrop-blur-[4px]" onClick={() => close(false)} />
      <div className="relative z-10 w-full max-w-md animate-fade-up overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-slate-900/[0.08]">
        <button
          onClick={() => close(false)}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={17} />
        </button>
        <div className="px-6 pb-5 pt-6">
          <div className="flex gap-4">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                danger ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"
              }`}
            >
              <Icon size={22} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h3 className="text-[17px] font-bold tracking-[-0.01em] text-ink-900">
                {opts.title || (danger ? "Please confirm" : "Confirm")}
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{opts.message}</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
          <button className="btn-ghost" onClick={() => close(false)}>
            {opts.cancelText || "Cancel"}
          </button>
          <button
            className={danger ? "btn bg-rose-600 font-bold text-white hover:bg-rose-700" : "btn-primary"}
            onClick={() => close(true)}
          >
            {opts.confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
