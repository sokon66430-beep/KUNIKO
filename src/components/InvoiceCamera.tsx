"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, RefreshCw, Check } from "lucide-react";

// Full-screen camera for scanning a paper invoice: live preview → shutter →
// review → "Use photo". Needs a secure (https) origin, like the barcode scanner.
export function InvoiceCamera({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [shot, setShot] = useState<string | null>(null); // captured frame under review

  useEffect(() => {
    if (!open) return;
    setError("");
    setShot(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        typeof window !== "undefined" && window.isSecureContext === false
          ? "The camera needs a secure (https) link — on plain http the browser blocks it. Use the upload option instead."
          : "This browser doesn't support the camera. Use the upload option instead.",
      );
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
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

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.78));
  }

  function usePhoto() {
    if (!shot) return;
    onCapture(shot);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <span className="text-sm font-semibold">Scan invoice</span>
        </div>
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <X size={20} />
        </button>
      </div>

      {/* Camera / review */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">{error}</div>
        ) : shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="Invoice preview" className="h-full w-full object-contain" />
        ) : (
          <>
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
            {/* framing guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[70%] w-[85%] rounded-2xl border-4 border-white/70" />
            </div>
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs font-medium text-white/80">
              Fit the whole invoice inside the frame
            </p>
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-6 px-4 py-5">
        {shot ? (
          <>
            <button
              onClick={() => setShot(null)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20"
            >
              <RefreshCw size={16} /> Retake
            </button>
            <button
              onClick={usePhoto}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-600"
            >
              <Check size={17} /> Use this photo
            </button>
          </>
        ) : !error ? (
          <button
            onClick={snap}
            title="Take photo"
            className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 transition hover:bg-white/40"
          >
            <span className="h-11 w-11 rounded-full bg-white" />
          </button>
        ) : (
          <button onClick={onClose} className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-ink-900">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
