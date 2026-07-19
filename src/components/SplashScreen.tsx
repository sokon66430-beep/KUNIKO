"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, ScanLine, Barcode, Tag, ReceiptText, ShoppingBag, Coins, Package } from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Stookii splash — "retail assembles into the brand".
//
// A ring of retail elements (cart, scanner, barcode, tag, receipt, bag, coins,
// box) fans in, then converges into the center and merges into the brand "S",
// which pops with a ripple. The wordmark rises with an accent line. Everything
// is lucide icons + CSS transforms (hardware-accelerated, no assets), theme
// aware, tap-to-skip and reduced-motion safe. Modern, clean, refreshing.
// ───────────────────────────────────────────────────────────────────────────
const FLOW = {
  converge: 0, // retail icons fan in + converge
  badge: 980, // the mark forms from the merge
  word: 1560, // wordmark rises
  line: 1820, // accent line + subtitle
  hold: 3100, // hold the finished lockup
  fadeOut: 480, // dissolve into the app
};

// The retail elements that make up a store — each a fresh accent colour.
const ICONS = [
  { Icon: ShoppingCart, color: "#3a63ff" },
  { Icon: ScanLine, color: "#0ea5e9" },
  { Icon: Barcode, color: "#6366f1" },
  { Icon: Tag, color: "#f43f5e" },
  { Icon: ReceiptText, color: "#8b5cf6" },
  { Icon: ShoppingBag, color: "#10b981" },
  { Icon: Coins, color: "#f59e0b" },
  { Icon: Package, color: "#14b8a6" },
];
const RADIUS = 116;

export function SplashScreen({ theme = "auto", onFinish }: { theme?: "dark" | "light" | "auto"; onFinish?: () => void }) {
  const [phase, setPhase] = useState<"play" | "out" | "done">("play");
  const [mode, setMode] = useState<"dark" | "light">(theme === "auto" ? "light" : theme);

  useEffect(() => {
    if (theme === "auto") {
      try {
        setMode(document.documentElement.classList.contains("dark") || localStorage.getItem("stookii-theme") === "dark" ? "dark" : "light");
      } catch {}
    }
    const out = setTimeout(() => setPhase("out"), FLOW.hold);
    const gone = setTimeout(() => {
      setPhase("done");
      onFinish?.();
    }, FLOW.hold + FLOW.fadeOut);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "done") return null;

  return (
    <div className={`sp-root sp-${mode} ${phase === "out" ? "sp-leaving" : ""}`} onClick={() => setPhase("out")} role="presentation">
      <div className="sp-lockup">
        <div className="sp-stage">
          {/* retail elements converging into the mark */}
          {ICONS.map(({ Icon, color }, i) => {
            const angle = (i / ICONS.length) * 2 * Math.PI - Math.PI / 2;
            const x = Math.round(Math.cos(angle) * RADIUS);
            const y = Math.round(Math.sin(angle) * RADIUS);
            return (
              <span
                key={i}
                className="sp-orb"
                style={{ color, ["--x" as any]: `${x}px`, ["--y" as any]: `${y}px`, animationDelay: `${i * 38}ms` }}
              >
                <Icon size={26} strokeWidth={2.3} />
              </span>
            );
          })}

          {/* ripple as the mark forms */}
          <span className="sp-ripple" />

          {/* the brand mark */}
          <svg viewBox="0 0 120 120" className="sp-badge" aria-hidden="true">
            <rect x="6" y="6" width="108" height="108" rx="30" fill="var(--sp-brand)" />
            <text x="60" y="63" fontSize="82" fontWeight="800" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-sans, 'Plus Jakarta Sans', Arial, sans-serif)" letterSpacing="-2" fill="#ffffff">
              S
            </text>
          </svg>
        </div>

        {/* Wordmark */}
        <div className="sp-word-wrap">
          <div className="sp-word">Stookii</div>
        </div>
        <div className="sp-line" />
        <div className="sp-sub">Smart Retail Management</div>
      </div>

      <style>{`
        .sp-root {
          position: fixed; inset: 0; z-index: 9999;
          display: grid; place-items: center;
          opacity: 1; transition: opacity ${FLOW.fadeOut}ms cubic-bezier(.4,0,.2,1);
          will-change: opacity; overflow: hidden;
        }
        .sp-root.sp-leaving { opacity: 0; pointer-events: none; }
        .sp-light {
          --sp-bg1: #ffffff; --sp-bg2: #eaf0fb;
          --sp-brand: #2549e8; --sp-ink: #0f1b3d; --sp-sub: #7086b0; --sp-glow: rgba(37,73,232,.20);
        }
        .sp-dark {
          --sp-bg1: #101a37; --sp-bg2: #070b19;
          --sp-brand: #3a63ff; --sp-ink: #ffffff; --sp-sub: #8ea3d6; --sp-glow: rgba(70,120,255,.34);
        }
        .sp-root { background: radial-gradient(120% 120% at 50% 34%, var(--sp-bg1) 0%, var(--sp-bg2) 100%); }

        .sp-lockup { display: flex; flex-direction: column; align-items: center; gap: clamp(18px, 3.5vmin, 28px); }
        /* Stage is only as big as the mark; the icon ring overflows it (icons are
           absolutely centred) so no empty space pads the wordmark. */
        .sp-stage { position: relative; width: clamp(120px, 30vmin, 148px); aspect-ratio: 1; overflow: visible; }

        /* retail elements: fan in at the ring, then rush to centre and merge */
        .sp-orb {
          position: absolute; left: 50%; top: 50%;
          display: grid; place-items: center;
          filter: drop-shadow(0 4px 12px currentColor);
          opacity: 0;
          animation: sp-converge 1120ms cubic-bezier(.55,0,.15,1) both;
        }
        @keyframes sp-converge {
          0%   { transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(.45) rotate(-12deg); opacity: 0; }
          22%  { transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(1) rotate(0deg); opacity: 1; }
          64%  { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(.18) rotate(8deg); opacity: 0; }
        }

        /* ripple ring when the mark forms */
        .sp-ripple {
          position: absolute; left: 50%; top: 50%; width: 100%; height: 100%;
          border-radius: 26%; border: 2px solid var(--sp-brand);
          transform: translate(-50%, -50%) scale(.5); opacity: 0;
          animation: sp-ripple 720ms ease ${FLOW.badge + 20}ms forwards;
        }
        @keyframes sp-ripple { 0% { opacity: .5; transform: translate(-50%,-50%) scale(.6); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.45); } }

        /* brand mark forms at the centre from the merge */
        .sp-badge {
          position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; overflow: visible;
          filter: drop-shadow(0 16px 38px var(--sp-glow));
          opacity: 0; transform: translate(-50%, -50%) scale(.4);
          animation: sp-pop 720ms cubic-bezier(.2,.85,.25,1.08) ${FLOW.badge}ms forwards,
                     sp-float 4.5s ease-in-out ${FLOW.word}ms infinite;
        }
        @keyframes sp-pop { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.4); } 55% { opacity: 1; } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
        @keyframes sp-float { 0%,100% { translate: 0 0; } 50% { translate: 0 -5px; } }

        .sp-word-wrap { overflow: hidden; padding: 0 .12em; }
        .sp-word {
          color: var(--sp-ink); font-weight: 800; font-size: clamp(26px, 6.4vmin, 40px);
          letter-spacing: -.02em; line-height: 1;
          transform: translateY(115%); opacity: 0;
          animation: sp-rise 720ms cubic-bezier(.16,.84,.28,1) ${FLOW.word}ms forwards;
        }
        .sp-line {
          height: 2px; width: 0; border-radius: 2px;
          background: linear-gradient(90deg, transparent, var(--sp-brand), transparent);
          animation: sp-linegrow 620ms cubic-bezier(.4,0,.2,1) ${FLOW.line}ms forwards;
        }
        .sp-sub {
          color: var(--sp-sub); font-weight: 600; font-size: clamp(11px, 2.3vmin, 13px);
          letter-spacing: .18em; text-transform: uppercase;
          opacity: 0; transform: translateY(6px);
          animation: sp-fade 620ms ease ${FLOW.line + 80}ms forwards;
        }

        @keyframes sp-rise { to { transform: translateY(0); opacity: 1; } }
        @keyframes sp-linegrow { to { width: clamp(120px, 26vmin, 168px); } }
        @keyframes sp-fade { to { opacity: 1; transform: translateY(0); } }

        @media (prefers-reduced-motion: reduce) {
          .sp-orb, .sp-ripple, .sp-badge, .sp-word, .sp-line, .sp-sub {
            animation-duration: 1ms !important; animation-delay: 0ms !important;
          }
          .sp-orb { opacity: 0 !important; }
          .sp-badge, .sp-word { opacity: 1 !important; }
          .sp-badge { transform: translate(-50%,-50%) scale(1); }
          .sp-word { transform: none; }
        }
      `}</style>
    </div>
  );
}
