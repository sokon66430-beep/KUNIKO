"use client";

import { useEffect, useState } from "react";

// A cute water-splash intro that plays with the "S": a droplet falls in, ripples
// spread, and the letter fills up with a sloshing wave of brand-blue water, then
// the whole thing floats away to reveal the app. Tap to skip; respects
// reduced-motion. Renders on first paint so there's no flash of the app first.
export function SplashIntro() {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");

  useEffect(() => {
    const hide = setTimeout(() => setPhase("out"), 2050);
    const gone = setTimeout(() => setPhase("done"), 2520);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "done") return null;

  const wave =
    "M -20 100 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 L 220 320 L -20 320 Z";

  return (
    <div className={`si-root ${phase === "out" ? "si-leaving" : ""}`} onClick={() => setPhase("out")} role="presentation">
      <div className="si-card">
        <svg className="si-svg" viewBox="0 0 200 200" width="156" height="156" aria-hidden="true">
          <defs>
            <text
              id="sGlyph"
              x="100"
              y="106"
              fontSize="188"
              fontWeight="900"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="Arial, Helvetica, sans-serif"
              letterSpacing="-8"
            >
              S
            </text>
            <clipPath id="sClip">
              <use href="#sGlyph" />
            </clipPath>
            <linearGradient id="sWater" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7cb2ff" />
              <stop offset="1" stopColor="#2549e8" />
            </linearGradient>
          </defs>

          {/* ripples spreading from the splash */}
          {[0, 1, 2].map((i) => (
            <circle key={i} cx="100" cy="100" r="30" fill="none" stroke="#a9ccff" strokeWidth="3">
              <animate attributeName="r" values="30;94" dur="1.9s" begin={`${0.5 + i * 0.55}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.65;0" dur="1.9s" begin={`${0.5 + i * 0.55}s`} repeatCount="indefinite" />
            </circle>
          ))}

          {/* the letter, filling up with water */}
          <g clipPath="url(#sClip)">
            <rect x="0" y="0" width="200" height="200" fill="#e8f2ff" />
            <g className="si-water">
              <path className="si-wave si-w1" d={wave} fill="url(#sWater)" />
              <path className="si-wave si-w2" d={wave} fill="#2549e8" opacity="0.5" />
            </g>
          </g>

          {/* crisp outline of the S */}
          <use href="#sGlyph" className="si-outline" fill="none" stroke="#2549e8" strokeWidth="3.5" strokeLinejoin="round" />

          {/* the droplet that kicks it off */}
          <circle className="si-drop" cx="100" cy="12" r="8" fill="#2549e8" />
        </svg>

        <div className="si-word">Stookii</div>
        <div className="si-sub">ON&nbsp;MART&nbsp;·&nbsp;RETAIL</div>
      </div>

      <style>{`
        .si-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(circle at 50% 42%, #ffffff 0%, #e8f3ff 48%, #cfe2ff 100%);
          opacity: 1; transition: opacity .46s ease; overflow: hidden;
        }
        .si-root.si-leaving { opacity: 0; pointer-events: none; }
        .si-card { display: flex; flex-direction: column; align-items: center; animation: si-in .7s cubic-bezier(.2,.9,.25,1.05) both; }
        .si-svg { overflow: visible; }
        .si-outline { animation: si-fade .45s ease .35s both; }
        .si-drop { animation: si-drop .62s cubic-bezier(.5,0,.7,1) both; transform-box: fill-box; transform-origin: center; }
        .si-water { animation: si-fill 1.25s cubic-bezier(.35,.1,.35,1) .48s both; }
        .si-w1 { animation: si-slosh1 1.5s linear infinite; }
        .si-w2 { animation: si-slosh2 2.3s linear infinite; }
        .si-word {
          margin-top: 20px; color: #16307a; font-weight: 800; font-size: 30px;
          letter-spacing: -.02em; animation: si-rise .6s ease-out .95s both;
        }
        .si-sub {
          margin-top: 7px; color: #6f92cf; font-size: 11px; font-weight: 700;
          letter-spacing: .22em; animation: si-rise .6s ease-out 1.1s both;
        }
        @keyframes si-in { 0% { opacity: 0; transform: scale(.72); } 60% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
        @keyframes si-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes si-drop {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 1; }
          72% { transform: translateY(84px) scaleY(1); opacity: 1; }
          86% { transform: translateY(90px) scaleY(.55) scaleX(1.4); opacity: .7; }
          100% { transform: translateY(92px) scaleY(.3) scaleX(1.7); opacity: 0; }
        }
        @keyframes si-fill { from { transform: translateY(120px); } to { transform: translateY(-64px); } }
        @keyframes si-slosh1 { from { transform: translateX(0); } to { transform: translateX(-60px); } }
        @keyframes si-slosh2 { from { transform: translateX(0); } to { transform: translateX(60px); } }
        @keyframes si-rise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .si-card, .si-outline, .si-drop, .si-water, .si-w1, .si-w2, .si-word, .si-sub { animation-duration: .01ms; animation-delay: 0s; }
        }
      `}</style>
    </div>
  );
}
