"use client";

import { useEffect, useState } from "react";

// A cute underwater water-splash intro that plays with the "S": a droplet drops
// in, bursts into little splash droplets and ripples, and the letter fills up
// with a sloshing wave of bright water — all over a deep ocean-blue backdrop
// with rising bubbles. Then it floats away to reveal the app. Tap to skip;
// respects reduced-motion. Renders on first paint (no flash of the app first).
export function SplashIntro() {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");

  useEffect(() => {
    const hide = setTimeout(() => setPhase("out"), 2350);
    const gone = setTimeout(() => setPhase("done"), 2850);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "done") return null;

  const wave =
    "M -20 100 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 q 15 -9 30 0 q 15 9 30 0 L 220 320 L -20 320 Z";

  // Little droplets that burst outward when the drop lands (dx/dy in SVG units).
  const splash = [
    [-55, -34], [-32, -52], [-8, -58], [16, -55], [40, -46], [58, -28], [-46, -14], [50, -10],
  ];
  // Rising bubbles (left %, size px, duration s, delay s).
  const bubbles = [
    [14, 16, 6.5, 0], [30, 9, 5, 1.4], [48, 22, 7.5, 0.6], [63, 12, 5.8, 2], [80, 14, 6.8, 1], [90, 8, 4.6, 0.3],
  ];

  return (
    <div className={`si-root ${phase === "out" ? "si-leaving" : ""}`} onClick={() => setPhase("out")} role="presentation">
      {bubbles.map(([left, size, dur, delay], i) => (
        <span
          key={i}
          className="si-bubble"
          style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `${delay}s` } as React.CSSProperties}
        />
      ))}

      <div className="si-card">
        <svg className="si-svg" viewBox="0 0 200 200" width="160" height="160" aria-hidden="true">
          <defs>
            <text id="sGlyph" x="100" y="106" fontSize="188" fontWeight="900" textAnchor="middle" dominantBaseline="central" fontFamily="Arial, Helvetica, sans-serif" letterSpacing="-8">S</text>
            <clipPath id="sClip"><use href="#sGlyph" /></clipPath>
            <linearGradient id="sWater" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7fe4ff" />
              <stop offset="1" stopColor="#2f7bf0" />
            </linearGradient>
          </defs>

          {/* ripples spreading from the splash */}
          {[0, 1, 2].map((i) => (
            <circle key={i} cx="100" cy="100" r="30" fill="none" stroke="#9fe3ff" strokeWidth="3">
              <animate attributeName="r" values="30;96" dur="1.9s" begin={`${0.5 + i * 0.55}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="1.9s" begin={`${0.5 + i * 0.55}s`} repeatCount="indefinite" />
            </circle>
          ))}

          {/* the letter, filling up with water */}
          <g clipPath="url(#sClip)">
            <rect x="0" y="0" width="200" height="200" fill="#2a52b8" />
            <g className="si-water">
              <path className="si-wave si-w1" d={wave} fill="url(#sWater)" />
              <path className="si-wave si-w2" d={wave} fill="#5fb8ff" opacity="0.45" />
            </g>
          </g>

          {/* bright outline of the S */}
          <use href="#sGlyph" className="si-outline" fill="none" stroke="#cdeeff" strokeWidth="3.5" strokeLinejoin="round" />

          {/* splash droplets bursting out on impact */}
          {splash.map(([dx, dy], i) => (
            <circle key={i} className="si-splash" cx="100" cy="100" r={i % 2 ? 3.4 : 4.4} fill="#a9ecff" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px` } as React.CSSProperties} />
          ))}

          {/* the droplet that kicks it off */}
          <circle className="si-drop" cx="100" cy="10" r="8" fill="#a9ecff" />
        </svg>

        <div className="si-word">Stookii</div>
        <div className="si-sub">ON&nbsp;MART&nbsp;·&nbsp;RETAIL</div>
      </div>

      <style>{`
        .si-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(circle at 50% 38%, #24499e 0%, #0c1b46 55%, #060e26 100%);
          opacity: 1; transition: opacity .5s ease; overflow: hidden;
        }
        .si-root.si-leaving { opacity: 0; pointer-events: none; }
        .si-bubble {
          position: absolute; bottom: -40px; border-radius: 50%;
          background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.55), rgba(159,227,255,.08));
          box-shadow: inset 0 0 3px rgba(255,255,255,.35);
          animation-name: si-bubble; animation-timing-function: linear; animation-iteration-count: infinite;
        }
        .si-card { position: relative; display: flex; flex-direction: column; align-items: center; animation: si-in .7s cubic-bezier(.2,.9,.25,1.05) both; }
        .si-svg { overflow: visible; }
        .si-outline { animation: si-fade .45s ease .35s both; }
        .si-drop { animation: si-drop .58s cubic-bezier(.5,0,.7,1) both; transform-box: fill-box; transform-origin: center; }
        .si-splash { transform-box: fill-box; transform-origin: center; opacity: 0; animation: si-splash .8s cubic-bezier(.3,.55,.45,1) .42s both; }
        .si-water { animation: si-fill 1.3s cubic-bezier(.35,.1,.35,1) .46s both; }
        .si-w1 { animation: si-slosh1 1.5s linear infinite; }
        .si-w2 { animation: si-slosh2 2.3s linear infinite; }
        .si-word { margin-top: 22px; color: #ffffff; font-weight: 800; font-size: 31px; letter-spacing: -.02em; text-shadow: 0 2px 18px rgba(60,140,255,.5); animation: si-rise .6s ease-out 1s both; }
        .si-sub { margin-top: 7px; color: #8fb8f5; font-size: 11px; font-weight: 700; letter-spacing: .24em; animation: si-rise .6s ease-out 1.15s both; }
        @keyframes si-in { 0% { opacity: 0; transform: scale(.72); } 60% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
        @keyframes si-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes si-drop {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 1; }
          72% { transform: translateY(86px) scaleY(1); opacity: 1; }
          88% { transform: translateY(92px) scaleY(.5) scaleX(1.4); opacity: .6; }
          100% { transform: translateY(94px) scaleY(.25) scaleX(1.7); opacity: 0; }
        }
        @keyframes si-splash {
          0% { transform: translate(0,0) scale(.3); opacity: 0; }
          14% { opacity: 1; transform: translate(calc(var(--dx) * .4), calc(var(--dy) * .55)) scale(1); }
          55% { transform: translate(var(--dx), var(--dy)) scale(.8); opacity: 1; }
          100% { transform: translate(calc(var(--dx) * 1.12), 52px) scale(.25); opacity: 0; }
        }
        @keyframes si-fill { from { transform: translateY(120px); } to { transform: translateY(-64px); } }
        @keyframes si-slosh1 { from { transform: translateX(0); } to { transform: translateX(-60px); } }
        @keyframes si-slosh2 { from { transform: translateX(0); } to { transform: translateX(60px); } }
        @keyframes si-rise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: none; } }
        @keyframes si-bubble { 0% { transform: translateY(0) translateX(0); opacity: 0; } 12% { opacity: .7; } 88% { opacity: .5; } 100% { transform: translateY(-108vh) translateX(16px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .si-card, .si-outline, .si-drop, .si-splash, .si-water, .si-w1, .si-w2, .si-word, .si-sub, .si-bubble { animation-duration: .01ms; animation-delay: 0s; animation-iteration-count: 1; }
        }
      `}</style>
    </div>
  );
}
