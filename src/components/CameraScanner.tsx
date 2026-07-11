"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { X, Camera, CheckCircle2 } from "lucide-react";

/**
 * Full-screen camera barcode scanner (works on Android + iOS Safari over HTTPS
 * or localhost). Stays open for continuous scanning — emits each barcode once,
 * with a short cooldown so one label isn't read dozens of times.
 */
export function CameraScanner({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    setError("");
    setCount(0);

    // Browsers only allow the camera on a secure origin (https) or localhost.
    // Over Wi-Fi the app is served on http://192.168.x.x, so the camera API is
    // missing — show a clear reason instead of a raw "undefined" error.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        typeof window !== "undefined" && window.isSecureContext === false
          ? "Camera scanning needs a secure (https) link. On a phone over Wi-Fi this address is plain http, so the browser blocks the camera. Type the barcode in the box instead — or ask for an https link to enable the camera."
          : "This browser doesn't support camera scanning. Type the barcode in the box instead.",
      );
      return;
    }

    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (!result || cancelled) return;
            const code = result.getText().trim();
            const now = Date.now();
            // Ignore the same code within 1.6s (each frame decodes it again).
            if (code === lastRef.current.code && now - lastRef.current.at < 1600) return;
            lastRef.current = { code, at: now };
            setFlash(code);
            setCount((c) => c + 1);
            if (navigator.vibrate) navigator.vibrate(60);
            window.setTimeout(() => setFlash(null), 700);
            onScan(code);
          },
        );
      } catch (e: any) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
            : e?.message || "Could not open the camera on this device.",
        );
      }
    })();

    return () => {
      cancelled = true;
      try {
        controls?.stop();
      } catch {
        /* ignore */
      }
    };
  }, [open, onScan]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <span className="text-sm font-semibold">Scan barcode</span>
          {count > 0 && (
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold">{count} scanned</span>
          )}
        </div>
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <X size={20} />
        </button>
      </div>

      {/* Camera */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">
            {error}
          </div>
        ) : (
          <>
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
            {/* Aiming frame */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-40 w-72 max-w-[80vw] rounded-2xl border-4 transition-colors ${
                  flash ? "border-emerald-400" : "border-white/80"
                }`}
              />
            </div>
            {flash && (
              <div className="absolute inset-x-0 bottom-24 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
                  <CheckCircle2 size={16} /> {flash}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom */}
      <div className="px-4 py-4 text-center">
        <p className="mb-3 text-xs text-white/60">
          Point the camera at a barcode — items are added automatically. Keep scanning, or tap Done.
        </p>
        <button onClick={onClose} className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-ink-900">
          Done
        </button>
      </div>
    </div>
  );
}
