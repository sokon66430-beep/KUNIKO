"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, RefreshCw, Check, Zap, ZapOff, Plus } from "lucide-react";

// Document scanner for paper invoices — not a plain photo:
//   · A4-shaped guide frame; the capture is CROPPED to exactly that frame
//   · the crop is enhanced like a scan (grayscale + levels stretch → white
//     paper, dark text) with a Color toggle for stamps/colored invoices
//   · high-resolution capture + torch (flash) toggle where supported
export function InvoiceCamera({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  // Returns every captured page (1 or more) — a multi-page invoice comes back
  // as several images in order.
  onCapture: (pages: string[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rawRef = useRef<HTMLCanvasElement | null>(null); // full-res crop, unprocessed
  const [error, setError] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]); // pages captured so far
  const [mode, setMode] = useState<"scan" | "color">("scan");
  const [torch, setTorch] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setShot(null);
    setPages([]);
    setMode("scan");
    setTorch(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        typeof window !== "undefined" && window.isSecureContext === false
          ? "The camera needs a secure (https) link — on plain http the browser blocks it."
          : "This browser doesn't support the camera.",
      );
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 }, // ask for the sharpest stream the camera has
          height: { ideal: 2160 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        const caps: any = track.getCapabilities?.();
        setTorchAvailable(!!caps?.torch);
      })
      .catch((e: any) => {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
            : e?.message || "Could not open the camera on this device.",
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await (track as any).applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch((t) => !t);
    } catch {
      /* not supported after all */
    }
  }

  // Make the crop look like a scan: grayscale, then stretch the levels so the
  // paper goes white and the ink goes black (histogram percentiles).
  function enhanceToScan(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      hist[y]++;
    }
    const total = d.length / 4;
    // Black point: the ink is only a small fraction of a document, so take the
    // 0.5th percentile. White point: the paper is the MAJORITY of pixels, so
    // the median luminance sits on the paper — mapping it to 255 turns the
    // whole background white while the text stays dark.
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * 0.005) {
        lo = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * 0.55) {
        hi = v;
        break;
      }
    }
    if (hi - lo < 50) hi = Math.min(255, lo + 50);
    const scale = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (y - lo) * scale));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderShot(which: "scan" | "color") {
    const raw = rawRef.current;
    if (!raw) return;
    const out = document.createElement("canvas");
    out.width = raw.width;
    out.height = raw.height;
    out.getContext("2d")!.drawImage(raw, 0, 0);
    if (which === "scan") enhanceToScan(out);
    setShot(out.toDataURL("image/jpeg", 0.82));
  }

  function snap() {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth) return;

    // Map the on-screen guide rectangle back to source-video pixels. The video
    // uses object-cover, so it's scaled up and cropped — undo that mapping.
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    const cover = Math.max(vr.width / sw, vr.height / sh);
    const ox = (sw * cover - vr.width) / 2; // cropped-off pixels (display units)
    const oy = (sh * cover - vr.height) / 2;
    const sx = (gr.left - vr.left + ox) / cover;
    const sy = (gr.top - vr.top + oy) / cover;
    const sWidth = gr.width / cover;
    const sHeight = gr.height / cover;

    // Full-resolution crop of just the frame area (cap the long edge at 2400px).
    const MAX = 2400;
    const outScale = Math.min(1, MAX / Math.max(sWidth, sHeight));
    const raw = document.createElement("canvas");
    raw.width = Math.round(sWidth * outScale);
    raw.height = Math.round(sHeight * outScale);
    raw.getContext("2d")!.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, raw.width, raw.height);
    rawRef.current = raw;
    renderShot(mode);
  }

  // Keep the current page and go back to the camera to shoot the next one.
  function addPage() {
    if (!shot) return;
    setPages((p) => [...p, shot]);
    setShot(null);
    rawRef.current = null;
  }
  // Finish — hand back every captured page (including the one on screen).
  function finish() {
    const all = shot ? [...pages, shot] : pages;
    if (!all.length) return;
    onCapture(all);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <span className="text-sm font-semibold">
            Scan invoice
            {pages.length > 0 && (
              <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold">
                {pages.length} page{pages.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!shot && torchAvailable && (
            <button
              onClick={toggleTorch}
              title="Flash"
              className={`grid h-9 w-9 place-items-center rounded-lg ${torch ? "bg-amber-400 text-black" : "bg-white/10 hover:bg-white/20"}`}
            >
              {torch ? <Zap size={18} /> : <ZapOff size={18} />}
            </button>
          )}
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Camera / review */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">{error}</div>
        ) : shot ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="Invoice scan" className="h-full w-full bg-black object-contain" />
            {/* Scan / Color toggle over the preview */}
            <div className="absolute inset-x-0 top-3 flex justify-center">
              <div className="inline-flex rounded-full bg-black/60 p-1 backdrop-blur">
                {(
                  [
                    { key: "scan", label: "Scan (B&W)" },
                    { key: "color", label: "Color" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.key}
                    onClick={() => {
                      setMode(o.key);
                      renderShot(o.key);
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      mode === o.key ? "bg-white text-black" : "text-white/80"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
            {/* Darken everything OUTSIDE the guide so the document area pops */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                ref={guideRef}
                className="relative rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                style={{ aspectRatio: "210/297", height: "72%", maxWidth: "88%" }}
              >
                {/* corner marks */}
                {[
                  "left-0 top-0 border-l-4 border-t-4 rounded-tl-xl",
                  "right-0 top-0 border-r-4 border-t-4 rounded-tr-xl",
                  "left-0 bottom-0 border-l-4 border-b-4 rounded-bl-xl",
                  "right-0 bottom-0 border-r-4 border-b-4 rounded-br-xl",
                ].map((c) => (
                  <span key={c} className={`absolute h-7 w-7 border-brand-400 ${c}`} />
                ))}
              </div>
            </div>
            <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs font-medium text-white/90">
              Fill the frame with the invoice — everything outside is cut away
            </p>
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-5">
        {shot ? (
          <>
            <button
              onClick={() => {
                setShot(null);
                rawRef.current = null;
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/20"
            >
              <RefreshCw size={16} /> Retake
            </button>
            <button
              onClick={addPage}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-3 text-sm font-bold text-white hover:bg-white/25"
            >
              <Plus size={17} /> Add page
            </button>
            <button
              onClick={finish}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-600"
            >
              <Check size={17} /> Done · {pages.length + 1} page{pages.length + 1 === 1 ? "" : "s"}
            </button>
          </>
        ) : !error ? (
          <>
            {pages.length > 0 && (
              <button
                onClick={finish}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-600"
              >
                <Check size={17} /> Done · {pages.length} page{pages.length === 1 ? "" : "s"}
              </button>
            )}
            <button
              onClick={snap}
              title={pages.length > 0 ? "Scan next page" : "Scan"}
              className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 transition hover:bg-white/40"
            >
              <span className="h-11 w-11 rounded-full bg-white" />
            </button>
          </>
        ) : (
          <button onClick={onClose} className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-ink-900">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
