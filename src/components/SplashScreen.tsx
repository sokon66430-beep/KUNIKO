"use client";

import { useEffect, useState } from "react";

// ───────────────────────────────────────────────────────────────────────────
// "Smart Retail Flow" — Stookii splash screen.
//
// A premium SaaS-style logo reveal: an ambient glow, a data particle that flows
// along and draws the S mark, a barcode scan sweep with a confirmation, the mark
// solidifying into the brand badge, then the wordmark. Built with CSS transforms
// + SVG (SMIL motion path) only — no animation library, no image assets — so it
// is hardware-accelerated, tiny, and never delays app startup.
//
// The whole timeline is configurable below (all values in ms from first paint).
// ───────────────────────────────────────────────────────────────────────────
const FLOW = {
  glowIn: 500, // Scene 1  0.0–0.5  ambient glow
  particleIn: 1000, // Scene 2  0.5–1.0  data particle + trail appear
  drawEnd: 1800, // Scene 3  1.0–1.8  particle draws the S outline
  scanEnd: 2300, // Scene 4  1.8–2.3  barcode scan + confirm
  solidEnd: 2800, // Scene 5  2.3–2.8  outline → solid, scale-up, glow pulse
  textEnd: 3000, // Scene 6  2.8–3.0  wordmark + subtitle
  hold: 3500, // hold the final frame (3.0s animation + ~0.5s hold)
  fadeOut: 460, // fade into the app / login
};

// The S mark as one flowing stroke — the "data path" the particle travels.
const S_PATH =
  "M110 56 C110 42 90 38 76 42 C60 47 58 64 78 72 C98 80 106 90 102 106 C98 120 74 124 58 118 C51 115 47 110 47 104";

export function SplashScreen({ theme = "dark", onFinish }: { theme?: "dark" | "light" | "auto"; onFinish?: () => void }) {
  const [phase, setPhase] = useState<"play" | "out" | "done">("play");
  const [mode, setMode] = useState<"dark" | "light">(theme === "auto" ? "dark" : theme);

  useEffect(() => {
    if (theme === "auto") {
      try {
        setMode(localStorage.getItem("stookii-theme") === "light" ? "light" : "dark");
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
    <div
      className={`ss-root ss-${mode} ${phase === "out" ? "ss-leaving" : ""}`}
      onClick={() => setPhase("out")}
      role="presentation"
    >
      <div className="ss-glow" />

      <div className="ss-stage">
        <svg className="ss-svg" viewBox="0 0 160 160" aria-hidden="true">
          {/* the solid brand badge that the mark resolves into (Scene 5) */}
          <g className="ss-badge">
            <rect x="24" y="24" width="112" height="112" rx="30" fill="var(--ss-badge)" />
            <text x="80" y="86" fontSize="104" fontWeight="900" textAnchor="middle" dominantBaseline="central" fontFamily="Arial, Helvetica, sans-serif" letterSpacing="-4" fill="var(--ss-badge-s)">
              S
            </text>
          </g>

          {/* the flowing S outline the particle draws (Scenes 3–4) */}
          <path
            id="ssPath"
            className="ss-draw"
            d={S_PATH}
            fill="none"
            stroke="var(--ss-line)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />

          {/* barcode scan sweep + faint bars (Scene 4) */}
          <g className="ss-scan" clipPath="url(#ssStage)">
            {[38, 52, 66, 84, 98, 112].map((x, i) => (
              <rect key={i} className="ss-bar" x={x} y="40" width={i % 2 ? 2 : 4} height="80" fill="var(--ss-line)" />
            ))}
            <rect className="ss-beam" x="0" y="30" width="5" height="100" fill="var(--ss-line)" />
          </g>
          <clipPath id="ssStage">
            <rect x="20" y="20" width="120" height="120" rx="30" />
          </clipPath>

          {/* confirmation tick (end of Scene 4) */}
          <path className="ss-check" d="M112 118 l8 8 l16 -18" fill="none" stroke="var(--ss-ok)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />

          {/* trailing particle + the lead data particle */}
          <circle className="ss-trail" r="5" fill="var(--ss-particle)">
            <animateMotion dur="0.8s" begin="1.06s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
              <mpath href="#ssPath" />
            </animateMotion>
          </circle>
          <circle className="ss-particle" r="4.5" fill="var(--ss-particle)">
            <animateMotion dur="0.8s" begin="1s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
              <mpath href="#ssPath" />
            </animateMotion>
          </circle>
        </svg>
      </div>

      <div className="ss-text">
        <div className="ss-word">STOOKII</div>
        <div className="ss-sub">Smart Retail Management</div>
      </div>

      <style>{`
        .ss-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: clamp(18px, 4vmin, 30px);
          opacity: 1; transition: opacity ${FLOW.fadeOut}ms ease; overflow: hidden;
          will-change: opacity;
        }
        .ss-root.ss-leaving { opacity: 0; pointer-events: none; }
        .ss-dark {
          --ss-bg1: #16223f; --ss-bg2: #0a1024; --ss-bg3: #05091a;
          --ss-line: #6fd3ff; --ss-particle: #eafaff; --ss-badge: #2549e8; --ss-badge-s: #ffffff;
          --ss-text: #ffffff; --ss-sub: #90b4f0; --ss-ok: #57e0a8; --ss-glow: rgba(70,150,255,.45);
        }
        .ss-light {
          --ss-bg1: #ffffff; --ss-bg2: #eef4fc; --ss-bg3: #dbe7f7;
          --ss-line: #2549e8; --ss-particle: #2f7bf0; --ss-badge: #2549e8; --ss-badge-s: #ffffff;
          --ss-text: #14224a; --ss-sub: #5f7bb5; --ss-ok: #12a97a; --ss-glow: rgba(60,130,255,.28);
        }
        .ss-root { background: radial-gradient(circle at 50% 42%, var(--ss-bg1) 0%, var(--ss-bg2) 55%, var(--ss-bg3) 100%); }

        .ss-glow {
          position: absolute; top: 42%; left: 50%; width: min(70vmin, 520px); height: min(70vmin, 520px);
          transform: translate(-50%, -50%); border-radius: 50%;
          background: radial-gradient(circle, var(--ss-glow) 0%, transparent 68%);
          opacity: 0; animation: ss-glow 2.4s ease ${0}ms both, ss-breathe 3s ease-in-out ${FLOW.glowIn}ms infinite;
        }
        .ss-stage { width: clamp(112px, 32vmin, 172px); aspect-ratio: 1; will-change: transform; }
        .ss-svg { width: 100%; height: 100%; overflow: visible; }

        /* Scene 5 — the solid badge resolves in */
        .ss-badge {
          opacity: 0; transform-box: fill-box; transform-origin: center;
          animation: ss-badge 620ms cubic-bezier(.2,.8,.25,1) ${FLOW.scanEnd}ms both;
          filter: drop-shadow(0 10px 34px var(--ss-glow));
        }
        /* Scene 3 — the outline draws, then fades as the badge takes over */
        .ss-draw {
          stroke-dasharray: 1; stroke-dashoffset: 1;
          animation: ss-draw 820ms cubic-bezier(.6,.05,.35,1) ${FLOW.particleIn}ms forwards,
                     ss-drawOut 320ms ease ${FLOW.scanEnd + 40}ms forwards;
          filter: drop-shadow(0 0 6px var(--ss-glow));
        }
        /* Scenes 2–3 — data particle + trail */
        .ss-particle { opacity: 0; filter: drop-shadow(0 0 7px var(--ss-particle)); animation: ss-pop 320ms ease ${FLOW.glowIn}ms both, ss-pfade 260ms ease ${FLOW.drawEnd - 60}ms forwards; }
        .ss-trail { opacity: 0; filter: drop-shadow(0 0 5px var(--ss-particle)); animation: ss-tfade 900ms ease ${FLOW.glowIn}ms both; }

        /* Scene 4 — barcode scan */
        .ss-scan { opacity: 0; animation: ss-scanShow 1ms linear ${FLOW.drawEnd}ms forwards; }
        .ss-beam { opacity: 0; filter: drop-shadow(0 0 8px var(--ss-line)); animation: ss-beam 480ms ease ${FLOW.drawEnd}ms forwards; }
        .ss-bar { opacity: 0; animation: ss-bars 480ms ease ${FLOW.drawEnd}ms forwards; }
        .ss-check { opacity: 0; stroke-dasharray: 1; stroke-dashoffset: 1; animation: ss-check 300ms ease ${FLOW.scanEnd - 120}ms forwards; }

        /* Scene 6 — text */
        .ss-text { text-align: center; }
        .ss-word { color: var(--ss-text); font-weight: 800; font-size: clamp(22px, 5vmin, 30px); letter-spacing: .28em; margin-right: -.28em; opacity: 0; animation: ss-rise 480ms ease ${FLOW.solidEnd}ms both; }
        .ss-sub { color: var(--ss-sub); font-weight: 600; font-size: clamp(11px, 2.4vmin, 13px); letter-spacing: .04em; margin-top: 9px; opacity: 0; animation: ss-rise 480ms ease ${FLOW.solidEnd + 110}ms both; }

        @keyframes ss-glow { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ss-breathe { 0%,100% { transform: translate(-50%,-50%) scale(.92); } 50% { transform: translate(-50%,-50%) scale(1.06); } }
        @keyframes ss-draw { to { stroke-dashoffset: 0; } }
        @keyframes ss-drawOut { to { opacity: 0; } }
        @keyframes ss-badge { 0% { opacity: 0; transform: scale(.95); } 60% { opacity: 1; transform: scale(1.015); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes ss-pop { 0% { opacity: 0; transform: scale(.2); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes ss-pfade { to { opacity: 0; } }
        @keyframes ss-tfade { 0% { opacity: 0; } 30% { opacity: .5; } 100% { opacity: 0; } }
        @keyframes ss-scanShow { to { opacity: 1; } }
        @keyframes ss-beam { 0% { opacity: 1; transform: translateX(0); } 92% { opacity: 1; } 100% { opacity: 0; transform: translateX(158px); } }
        @keyframes ss-bars { 0% { opacity: 0; } 30% { opacity: .5; } 70% { opacity: .5; } 100% { opacity: .16; } }
        @keyframes ss-check { 0% { opacity: 1; stroke-dashoffset: 1; } 100% { opacity: 1; stroke-dashoffset: 0; } }
        @keyframes ss-rise { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: none; } }

        @media (prefers-reduced-motion: reduce) {
          .ss-glow, .ss-badge, .ss-draw, .ss-particle, .ss-trail, .ss-scan, .ss-beam, .ss-bar, .ss-check, .ss-word, .ss-sub {
            animation-duration: 1ms !important; animation-delay: 0ms !important;
          }
        }
      `}</style>
    </div>
  );
}
