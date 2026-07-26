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
  badge: 600, // the mark forms from the merge — CENTRED on screen
  reveal: 1250, // the whole lockup slides left (GPU transform) as the text fades in
  word: 1480, // wordmark rises once the slide is mostly home
  line: 1660, // accent line + subtitle
  hold: 2600, // hold the finished lockup
  fadeOut: 360, // dissolve into the app
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
const RADIUS = 100;

export function SplashScreen({ theme = "auto", onFinish }: { theme?: "dark" | "light" | "auto"; onFinish?: () => void }) {
  const [phase, setPhase] = useState<"play" | "out" | "done">("play");
  const [mode, setMode] = useState<"dark" | "light">(theme === "auto" ? "light" : theme);

  useEffect(() => {
    // Customer-facing screens never show it. The queue TV on the wall and the
    // T3's second display are signage: a customer looking for their number
    // should see the board, not our logo animating. This lives here rather than
    // in AppShell because the splash is mounted by the root layout, outside it.
    const p = window.location.pathname;
    if (p === "/queue-display" || p === "/customer-display") {
      setPhase("done");
      onFinish?.();
      return;
    }

    // The splash is store branding — show it ONCE when the app first opens, but
    // NOT on every in-session reload. Switching staff at the till reloads the
    // page; replaying the 3s splash each time reads as a freeze/glitch. Skip it
    // whenever this browser session has already seen it.
    let seen = false;
    try {
      seen = sessionStorage.getItem("stookii-splash-seen") === "1";
    } catch {}
    if (seen) {
      setPhase("done");
      onFinish?.();
      return;
    }
    try {
      sessionStorage.setItem("stookii-splash-seen", "1");
    } catch {}

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
                style={{ color, ["--x" as any]: `${x}px`, ["--y" as any]: `${y}px`, animationDelay: `${i * 22}ms` }}
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
            {/* Baseline placed by measured ink metrics (glyph ascent 62 / descent 1
                at 82px → baseline 60 + (62−1)/2 = 90.5) so the S is optically
                centred in the box on every browser — dominant-baseline rendering
                differs across engines. */}
            <text x="60" y="90.5" fontSize="82" fontWeight="800" textAnchor="middle" fontFamily="var(--font-sans, 'Plus Jakarta Sans', Arial, sans-serif)" fill="#ffffff">
              S
            </text>
          </svg>
        </div>

        {/* Wordmark + slogan — beside the mark, like an app header lockup */}
        <div className="sp-text">
          <div className="sp-word-wrap">
            <div className="sp-word">Stookii</div>
          </div>
          <div className="sp-line" />
          <div className="sp-sub">Smart Retail Management</div>
        </div>
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

        /* Horizontal lockup. The LAYOUT never animates — the row is laid out in
           its final shape from the start, and the whole lockup begins shifted
           right by half the text width so the (still-alone) badge sits at the
           screen centre. At reveal it slides to 0 on a pure transform — GPU
           compositing, no reflow per frame — while the text fades in beside it.
           Animating max-width/margin (layout) was what stuttered. */
        .sp-lockup {
          display: flex; flex-direction: row; align-items: center; gap: clamp(20px, 4.5vmin, 34px);
          transform: translateX(clamp(96px, 13vmin, 122px));
          will-change: transform;
          animation: sp-slide 620ms cubic-bezier(.65,0,.35,1) ${FLOW.reveal}ms forwards;
        }
        @keyframes sp-slide { to { transform: translateX(0); } }
        .sp-text {
          display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
          white-space: nowrap; opacity: 0;
          animation: sp-fade 460ms ease ${FLOW.reveal + 200}ms forwards;
        }
        /* Stage is only as big as the mark; the icon ring overflows it (icons are
           absolutely centred) so no empty space pads the wordmark. */
        .sp-stage { position: relative; width: clamp(96px, 24vmin, 124px); aspect-ratio: 1; overflow: visible; }

        /* retail elements: fan in at the ring, then rush to centre and merge */
        .sp-orb {
          position: absolute; left: 50%; top: 50%;
          display: grid; place-items: center;
          filter: drop-shadow(0 3px 8px currentColor);
          opacity: 0;
          animation: sp-converge 680ms cubic-bezier(.55,0,.15,1) both;
        }
        @keyframes sp-converge {
          0%   { transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(.5); opacity: 0; }
          28%  { transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(1); opacity: 1; }
          60%  { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(.2); opacity: 0; }
        }

        /* ripple ring when the mark forms */
        .sp-ripple {
          position: absolute; left: 50%; top: 50%; width: 100%; height: 100%;
          border-radius: 26%; border: 2px solid var(--sp-brand);
          transform: translate(-50%, -50%) scale(.5); opacity: 0;
          animation: sp-ripple 560ms ease ${FLOW.badge + 20}ms forwards;
        }
        @keyframes sp-ripple { 0% { opacity: .5; transform: translate(-50%,-50%) scale(.6); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.45); } }

        /* brand mark forms at the centre from the merge */
        .sp-badge {
          position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; overflow: visible;
          filter: drop-shadow(0 10px 24px var(--sp-glow));
          opacity: 0; transform: translate(-50%, -50%) scale(.4);
          animation: sp-pop 520ms cubic-bezier(.2,.9,.3,1.04) ${FLOW.badge}ms forwards;
        }
        /* No idle float: once the mark lands it stays perfectly still — a logo
           that keeps drifting reads as unstable, not alive. */
        @keyframes sp-pop { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.5); } 50% { opacity: 1; } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }

        .sp-word-wrap { overflow: hidden; padding: 0 .12em; }
        .sp-word {
          color: var(--sp-ink); font-weight: 800; font-size: clamp(24px, 5.4vmin, 34px);
          letter-spacing: -.02em; line-height: 1;
          transform: translateY(115%); opacity: 0;
          animation: sp-rise 520ms cubic-bezier(.16,.84,.28,1) ${FLOW.word}ms forwards;
        }
        .sp-line {
          height: 2px; width: 0; border-radius: 2px;
          background: linear-gradient(90deg, var(--sp-brand), transparent);
          animation: sp-linegrow 460ms cubic-bezier(.4,0,.2,1) ${FLOW.line}ms forwards;
        }
        .sp-sub {
          color: var(--sp-sub); font-weight: 600; font-size: clamp(11px, 2.3vmin, 13px);
          letter-spacing: .18em; text-transform: uppercase;
          opacity: 0; transform: translateY(6px);
          animation: sp-fade 460ms ease ${FLOW.line + 60}ms forwards;
        }

        @keyframes sp-rise { to { transform: translateY(0); opacity: 1; } }
        @keyframes sp-linegrow { to { width: clamp(120px, 26vmin, 168px); } }
        @keyframes sp-fade { to { opacity: 1; transform: translateY(0); } }

        @media (prefers-reduced-motion: reduce) {
          .sp-lockup, .sp-orb, .sp-ripple, .sp-badge, .sp-text, .sp-word, .sp-line, .sp-sub {
            animation-duration: 1ms !important; animation-delay: 0ms !important;
          }
          .sp-orb { opacity: 0 !important; }
          .sp-badge, .sp-text, .sp-word { opacity: 1 !important; }
          .sp-lockup { transform: none; }
          .sp-badge { transform: translate(-50%,-50%) scale(1); }
          .sp-word { transform: none; }
        }
      `}</style>
    </div>
  );
}
