"use client";

import { useRef } from "react";
import { Printer, FileType2, X } from "lucide-react";

// In-app PDF viewer with Print + Download, used wherever a document (goods
// receipt, stock count sheet, etc.) needs to be previewed and printed without
// forcing a raw file download first. `title` names the downloaded file (e.g.
// "GRN-100002"); `heading` is the display text shown at the top (defaults to
// `title` if the two are the same).
export function PdfViewer({
  url,
  title,
  heading,
  onClose,
}: {
  url: string;
  title: string;
  heading?: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  function print() {
    const w = frameRef.current?.contentWindow;
    if (w) {
      w.focus();
      w.print();
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-900/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-ink-900">{heading || title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={print} className="btn-primary !py-2 text-sm">
              <Printer size={15} /> Print
            </button>
            <a href={url} download={`${title}.pdf`} className="btn-ghost !py-2 text-sm">
              <FileType2 size={15} /> Download
            </a>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <iframe ref={frameRef} src={url} title={title} className="w-full flex-1" />
      </div>
    </div>
  );
}
