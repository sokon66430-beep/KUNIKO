"use client";

import { useEffect, useState } from "react";

// A short branded intro that plays when the app opens: the "S" mark pops in, the
// wordmark rises, then the whole thing fades away to reveal the app. Tap anywhere
// to skip. It renders only on the client (after mount) so it never blocks the
// first paint, and it plays once per app launch.
export function SplashIntro() {
  // "in" = playing, "out" = fading away, "done" = removed from the tree.
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");

  useEffect(() => {
    setPhase("in");
    const hide = setTimeout(() => setPhase("out"), 1500);
    const gone = setTimeout(() => setPhase("done"), 1950);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className={`si-root ${phase === "out" ? "si-leaving" : ""}`}
      onClick={() => setPhase("out")}
      role="presentation"
    >
      <div className="si-glow" />
      <div className="si-stack">
        <div className="si-badge">S</div>
        <div className="si-word">Stookii</div>
        <div className="si-sub">ON&nbsp;MART&nbsp;·&nbsp;RETAIL</div>
        <div className="si-dots">
          <span />
          <span />
          <span />
        </div>
      </div>

      <style>{`
        .si-root {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(120% 120% at 50% 35%, #1e2e88 0%, #0b1120 60%);
          opacity: 1; transition: opacity .42s ease;
          overflow: hidden;
        }
        .si-root.si-leaving { opacity: 0; pointer-events: none; }
        .si-glow {
          position: absolute; width: 460px; height: 460px; border-radius: 50%;
          background: radial-gradient(circle, rgba(59,102,245,.55) 0%, rgba(59,102,245,0) 70%);
          filter: blur(6px);
          animation: si-breathe 2.2s ease-in-out infinite;
        }
        .si-stack { position: relative; display: flex; flex-direction: column; align-items: center; }
        .si-badge {
          width: 96px; height: 96px; border-radius: 26px;
          display: flex; align-items: center; justify-content: center;
          background: #2549e8; color: #fff;
          font-family: Arial, Helvetica, sans-serif; font-weight: 900; font-size: 58px;
          letter-spacing: -3px;
          box-shadow: 0 18px 50px rgba(37,73,232,.55);
          animation: si-pop .72s cubic-bezier(.18,.9,.24,1.04) both;
        }
        .si-word {
          margin-top: 22px; color: #fff; font-weight: 800; font-size: 30px;
          letter-spacing: -.02em;
          animation: si-rise .6s ease-out .32s both;
        }
        .si-sub {
          margin-top: 8px; color: #93b4fd; font-size: 11px; font-weight: 700;
          letter-spacing: .22em;
          animation: si-rise .6s ease-out .46s both;
        }
        .si-dots { display: flex; gap: 7px; margin-top: 26px; animation: si-rise .6s ease-out .6s both; }
        .si-dots span {
          width: 7px; height: 7px; border-radius: 50%; background: #3b66f5;
          animation: si-blink 1s ease-in-out infinite;
        }
        .si-dots span:nth-child(2) { animation-delay: .16s; }
        .si-dots span:nth-child(3) { animation-delay: .32s; }
        @keyframes si-pop {
          0% { opacity: 0; transform: scale(.55) translateY(10px); }
          60% { opacity: 1; transform: scale(1.07); }
          100% { transform: scale(1); }
        }
        @keyframes si-rise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: none; } }
        @keyframes si-breathe { 0%,100% { transform: scale(.9); opacity: .8; } 50% { transform: scale(1.08); opacity: 1; } }
        @keyframes si-blink { 0%,100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
        @media (prefers-reduced-motion: reduce) {
          .si-badge, .si-word, .si-sub, .si-dots, .si-glow { animation: none; }
        }
      `}</style>
    </div>
  );
}
