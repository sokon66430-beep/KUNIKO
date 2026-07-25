"use client";

import { useEffect, useRef, useState } from "react";
import { Check, QrCode, ShoppingBag } from "lucide-react";
import { usd, riel, num } from "@/lib/format";
import {
  type CDState,
  readCustomerDisplay,
  subscribeCustomerDisplay,
} from "@/lib/customerDisplay";
import type { CustomerDisplaySettings } from "@/lib/types";

// The second screen on the Sunmi T3 — the one CUSTOMERS look at. Warm, rounded
// and friendly (soft cards, pastel accent tints, big type), not a dense operator
// panel. Live sale data arrives over the local channel (no server); the LOOK
// (theme, colour, greetings, logo, promo pictures) is the owner's Customer
// Screen design, fetched from /api/business — on the T3 this page shares the
// cashier's login, so it succeeds; anywhere else it falls back to the defaults.

type Cfg = CustomerDisplaySettings & { storeName?: string; logo?: string };

const DEFAULTS: Required<Omit<CustomerDisplaySettings, "ads">> & { ads: string[] } = {
  theme: "dark",
  brandName: "ON MART",
  accent: "#6ea0ff",
  welcomeLine: "Welcome · សូមស្វាគមន៍",
  idleSub: "Please hand your items to our cashier",
  thanksTitle: "Thank you",
  thanksSub: "អរគុណ",
  showLogo: true,
  showRiel: true,
  ads: [],
  adSeconds: 6,
};

// Soft rgba from a #rrggbb, for pastel accent tints.
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return `rgba(110,160,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function CustomerDisplayPage() {
  const [state, setState] = useState<CDState | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState(readCustomerDisplay());
    return subscribeCustomerDisplay(setState);
  }, []);

  // Pull the owner's Customer Screen design. Re-checked every 60s so a change
  // saved on the back office shows up without anyone touching the till screen.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/business", { credentials: "include" });
        if (!r.ok) return;
        const b = await r.json();
        if (alive) setCfg({ ...b.customerDisplay, storeName: b.name, logo: b.logo });
      } catch {
        /* no session / offline — defaults apply */
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Keep the newest scanned line in view as the basket grows.
  useEffect(() => {
    if (state?.kind === "sale" && listRef.current) listRef.current.scrollTop = 0;
  }, [state]);

  const c = { ...DEFAULTS, ...(cfg || {}) };
  // What customers see as the brand: the owner's chosen brand name (e.g. "ON
  // MART") wins over the app/store name, so the second screen shows the store's
  // own brand, not "Stookii".
  const storeName =
    c.brandName ||
    (state && "storeName" in state && state.storeName) ||
    cfg?.storeName ||
    "ON Mart";
  const showRiel = c.showRiel !== false;

  const light = c.theme === "light";
  const vars: React.CSSProperties = {
    ["--cd-accent" as any]: c.accent,
    ["--cd-soft" as any]: rgba(c.accent, light ? 0.12 : 0.18),
    ["--cd-soft2" as any]: rgba(c.accent, light ? 0.08 : 0.12),
    ["--cd-bg" as any]: light ? "#f5f7fc" : "#0f1729",
    ["--cd-fg" as any]: light ? "#141b2e" : "#f4f6fb",
    ["--cd-muted" as any]: light ? "#6b7896" : "#9db0d0",
    ["--cd-card" as any]: light ? "#ffffff" : "rgba(255,255,255,0.055)",
    ["--cd-border" as any]: light ? "rgba(20,30,60,0.06)" : "rgba(255,255,255,0.08)",
    ["--cd-shadow" as any]: light ? "0 12px 34px rgba(24,36,70,0.10)" : "0 14px 40px rgba(0,0,0,0.36)",
  };

  // Between customers, the promo pictures take the WHOLE screen (no chrome) —
  // it's a billboard until the next scan.
  const idle = !state || state.kind === "idle";
  if (idle && c.ads.length > 0) {
    return (
      <div className="cd-root" style={vars}>
        <style>{CSS}</style>
        <AdSlides ads={c.ads} seconds={c.adSeconds} full />
      </div>
    );
  }

  return (
    <div className="cd-root" style={vars}>
      <style>{CSS}</style>

      <header className="cd-top">
        <span className="cd-brand">
          <span className="cd-brand-badge">
            {cfg?.logo && c.showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.logo} alt="" className="cd-brand-logo" />
            ) : (
              <ShoppingBag size={22} strokeWidth={2.4} />
            )}
          </span>
          {storeName}
        </span>
        {state?.kind === "sale" && (
          <span className="cd-count">
            {num(state.itemCount)} item{state.itemCount === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {idle && <Idle storeName={storeName} c={c} logo={cfg?.logo} />}
      {state?.kind === "sale" && <Sale state={state} c={c} listRef={listRef} showRiel={showRiel} />}
      {state?.kind === "khqr" && <Khqr state={state} />}
      {state?.kind === "thanks" && <Thanks state={state} c={c} showRiel={showRiel} />}
    </div>
  );
}

// A rotating promo-picture slideshow. `full` = fill the whole screen (idle
// billboard); otherwise it fills whatever pane it's placed in (the 60% beside
// the basket during a sale).
function AdSlides({ ads, seconds, full }: { ads: string[]; seconds: number; full?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (ads.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % ads.length), Math.max(3, seconds) * 1000);
    return () => clearInterval(t);
  }, [ads.length, seconds]);
  const idx = Math.min(i, ads.length - 1);
  return (
    <div className={full ? "cd-fullads" : "cd-adpane"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ads[idx]} alt="" className={full ? "cd-fullads-img" : "cd-adpane-img"} />
      {ads.length > 1 && (
        <div className="cd-dots">
          {ads.map((_, k) => (
            <span key={k} className={`cd-dot${k === idx ? " on" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Idle({ storeName, c, logo }: { storeName: string; c: typeof DEFAULTS; logo?: string }) {
  // Ads-idle is drawn full-screen by the parent, so here it's the branding rest.
  return (
    <div className="cd-center cd-idle">
      <div className="cd-logo-badge">
        {logo && c.showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="cd-idle-logo" />
        ) : (
          <ShoppingBag size={64} strokeWidth={2} />
        )}
      </div>
      <h1>{storeName}</h1>
      {c.welcomeLine && <p className="cd-welcome">{c.welcomeLine}</p>}
      {c.idleSub && <p className="cd-sub cd-pill">{c.idleSub}</p>}
    </div>
  );
}

function Sale({
  state,
  c,
  listRef,
  showRiel,
}: {
  state: Extract<CDState, { kind: "sale" }>;
  c: typeof DEFAULTS;
  listRef: React.RefObject<HTMLDivElement>;
  showRiel: boolean;
}) {
  const hasAds = (c.ads || []).length > 0;

  const items = (
    <div className="cd-list" ref={listRef}>
      {state.lines.length === 0 ? (
        <p className="cd-empty">Scanning your items…</p>
      ) : (
        state.lines.map((l, i) => (
          <div className="cd-line" key={i}>
            <span className="cd-qty">{num(l.qty)}×</span>
            <span className="cd-name">
              {l.name}
              {l.unitLabel ? <em> · {l.unitLabel}</em> : null}
            </span>
            <span className="cd-lt">{usd(l.lineTotal)}</span>
          </div>
        ))
      )}
    </div>
  );

  const totalCard = (
    <div className="cd-totcard">
      {state.discount > 0 && (
        <div className="cd-disc">
          <span>Discount</span>
          <span>−{usd(state.discount)}</span>
        </div>
      )}
      <div className="cd-totlabel">Total to pay</div>
      <div className="cd-tot">{usd(state.total)}</div>
      {showRiel && <div className="cd-riel">{riel(state.total)}</div>}
      <div className="cd-vat">VAT 10% included</div>
    </div>
  );

  // With promo pictures: 40% the customer's basket + total, 60% advertising.
  if (hasAds) {
    return (
      <div className="cd-sale-ads">
        <div className="cd-buy">
          {items}
          {totalCard}
        </div>
        <AdSlides ads={c.ads} seconds={c.adSeconds} />
      </div>
    );
  }

  // No pictures: the original wide item list + total pane.
  return (
    <div className="cd-sale">
      {items}
      <aside className="cd-totalpane">{totalCard}</aside>
    </div>
  );
}

function Khqr({ state }: { state: Extract<CDState, { kind: "khqr" }> }) {
  return (
    <div className="cd-center cd-khqr">
      <div className="cd-khqr-head">
        <QrCode size={28} strokeWidth={2.4} />
        Scan to pay · បង់ប្រាក់
      </div>
      <div className="cd-qrcard">
        {state.qrImage ? (
          <img src={state.qrImage} alt="KHQR payment code" className="cd-qrimg" />
        ) : (
          <div className="cd-qrimg cd-qr-wait">Loading…</div>
        )}
      </div>
      <div className="cd-khqr-amt">{usd(state.amount)}</div>
      <p className="cd-sub cd-pill">Open any bank app — ABA, Wing, Bakong — and scan</p>
    </div>
  );
}

function Thanks({
  state,
  c,
  showRiel,
}: {
  state: Extract<CDState, { kind: "thanks" }>;
  c: typeof DEFAULTS;
  showRiel: boolean;
}) {
  const hasChange = typeof state.change === "number" && state.change > 0.0001;
  return (
    <div className="cd-center cd-thanks">
      <div className="cd-tick">
        <Check size={60} strokeWidth={3} />
      </div>
      <h1>{c.thanksTitle}</h1>
      {c.thanksSub && <p className="cd-welcome">{c.thanksSub}</p>}
      {hasChange && (
        <div className="cd-change">
          <div className="cd-change-l">Your change</div>
          <div className="cd-change-v">{usd(state.change as number)}</div>
          {showRiel && <div className="cd-change-r">{riel(state.change as number)}</div>}
        </div>
      )}
      <p className="cd-sub cd-pill">Paid {usd(state.total)} · {state.method}</p>
    </div>
  );
}

const CSS = `
.cd-root {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: var(--cd-bg); color: var(--cd-fg);
  /* Plus Jakarta for Latin, Kantumruy Pro for Khmer — so "សូមស្វាគមន៍ / អរគុណ"
     render in Kantumruy Pro (Bold weights used on headings). */
  font-family: 'Plus Jakarta Sans Variable', 'Kantumruy Pro', 'Battambang', 'Noto Sans Khmer', 'Khmer UI', 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}
.cd-top {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 22px 40px;
}
.cd-brand { display: inline-flex; align-items: center; gap: 16px; font-size: 28px; font-weight: 800; letter-spacing: -0.015em; color: var(--cd-fg); }
.cd-brand-badge { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: var(--cd-soft); color: var(--cd-accent); overflow: hidden; }
.cd-brand-logo { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
.cd-count { font-size: 19px; font-weight: 700; color: var(--cd-accent); background: var(--cd-soft); padding: 8px 18px; border-radius: 999px; }

.cd-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; padding: 40px; min-height: 0; }
.cd-sub { margin: 0; font-size: clamp(17px, 2vw, 24px); color: var(--cd-muted); }
.cd-pill { background: var(--cd-card); box-shadow: var(--cd-shadow); padding: 12px 26px; border-radius: 999px; }

/* Idle */
.cd-logo-badge {
  display: grid; place-items: center; width: clamp(120px, 16vw, 180px); height: clamp(120px, 16vw, 180px);
  border-radius: 40px; background: var(--cd-soft); color: var(--cd-accent); box-shadow: var(--cd-shadow);
  animation: cd-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
.cd-idle-logo { max-width: 72%; max-height: 72%; object-fit: contain; }
.cd-idle h1 { margin: 6px 0 0; font-size: clamp(44px, 6vw, 78px); font-weight: 800; letter-spacing: -0.025em; }
.cd-welcome { margin: 0; font-size: clamp(24px, 3vw, 40px); font-weight: 800; color: var(--cd-accent); letter-spacing: -0.01em; }

/* Full-screen promo billboard (idle, between customers) */
.cd-fullads { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--cd-bg); }
.cd-fullads-img { width: 100%; height: 100%; object-fit: contain; }
.cd-fullads .cd-dots { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); }
.cd-dots { display: flex; gap: 9px; margin-top: 4px; }
.cd-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--cd-border); transition: all 0.3s; }
.cd-dot.on { background: var(--cd-accent); width: 26px; }

/* Sale WITH promo pictures: 40% the customer's basket + total, 60% advertising */
.cd-sale-ads { flex: 1; display: grid; grid-template-columns: 2fr 3fr; min-height: 0; gap: 10px; padding: 10px 18px 20px; }
.cd-buy { display: flex; flex-direction: column; min-height: 0; gap: 10px; }
.cd-buy .cd-list { flex: 1; }
.cd-buy .cd-totcard { flex: 0 0 auto; }
.cd-adpane { position: relative; display: flex; align-items: center; justify-content: center; min-height: 0; }
.cd-adpane-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 26px; box-shadow: var(--cd-shadow); }
.cd-adpane .cd-dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); margin: 0; }

/* Sale — item list + total card */
.cd-sale { flex: 1; display: grid; grid-template-columns: 1fr 40%; min-height: 0; gap: 8px; padding: 8px 20px 24px; }
.cd-list { overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 12px; }
.cd-empty { color: var(--cd-muted); font-size: 30px; font-weight: 600; margin: auto; }
.cd-line {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px;
  padding: 20px 26px; border-radius: 22px; background: var(--cd-card); box-shadow: var(--cd-shadow);
  font-size: clamp(21px, 2.3vw, 32px);
  animation: cd-slide 0.28s ease;
}
.cd-qty { font-weight: 800; color: var(--cd-accent); font-variant-numeric: tabular-nums; background: var(--cd-soft); border-radius: 12px; padding: 4px 12px; }
.cd-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-name em { font-style: normal; color: var(--cd-muted); font-weight: 500; }
.cd-lt { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

.cd-totalpane { display: flex; padding: 14px 12px; min-height: 0; }
.cd-totcard {
  flex: 1; background: var(--cd-soft2); border: 1.5px solid var(--cd-soft);
  border-radius: 32px; display: flex; flex-direction: column; justify-content: center; align-items: center;
  text-align: center; padding: 30px; box-shadow: var(--cd-shadow);
}
.cd-disc { display: flex; gap: 16px; align-items: center; font-size: 24px; color: #e05a97; font-weight: 800; margin-bottom: 16px; background: var(--cd-card); padding: 8px 20px; border-radius: 999px; }
.cd-totlabel { font-size: clamp(17px, 1.8vw, 23px); color: var(--cd-muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
.cd-tot { font-size: clamp(58px, 9vw, 138px); font-weight: 800; letter-spacing: -0.035em; line-height: 1; font-variant-numeric: tabular-nums; color: var(--cd-fg); margin: 6px 0; }
.cd-riel { font-size: clamp(24px, 3vw, 40px); font-weight: 800; color: var(--cd-accent); font-variant-numeric: tabular-nums; background: var(--cd-soft); padding: 6px 20px; border-radius: 999px; }
.cd-vat { font-size: 15px; color: var(--cd-muted); margin-top: 14px; }

/* KHQR */
.cd-khqr-head { display: inline-flex; align-items: center; gap: 12px; font-size: clamp(24px,3vw,34px); font-weight: 800; color: var(--cd-fg); }
.cd-khqr-head svg { color: var(--cd-accent); }
.cd-qrcard { background: #fff; border-radius: 32px; padding: 26px; box-shadow: var(--cd-shadow); }
.cd-qrimg { display: block; width: min(44vh, 420px); height: min(44vh, 420px); border-radius: 14px; }
.cd-qr-wait { display: flex; align-items: center; justify-content: center; color: #0e1526; font-size: 24px; font-weight: 700; }
.cd-khqr-amt { font-size: clamp(44px, 7vw, 92px); font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

/* Thanks */
.cd-tick { width: 132px; height: 132px; border-radius: 999px; background: #12b76a; display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 0 0 14px rgba(18,183,106,0.16); animation: cd-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
.cd-thanks h1 { margin: 10px 0 0; font-size: clamp(48px, 7vw, 90px); font-weight: 800; letter-spacing: -0.025em; }
.cd-change { margin-top: 8px; background: var(--cd-card); border: 1.5px solid var(--cd-soft); border-radius: 30px; padding: 26px 52px; box-shadow: var(--cd-shadow); }
.cd-change-l { font-size: 22px; color: var(--cd-muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
.cd-change-v { font-size: clamp(48px, 8vw, 104px); font-weight: 800; letter-spacing: -0.02em; color: #12b76a; font-variant-numeric: tabular-nums; line-height: 1.05; }
.cd-change-r { font-size: clamp(22px,3vw,34px); font-weight: 800; color: var(--cd-accent); font-variant-numeric: tabular-nums; }

@keyframes cd-pop { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes cd-slide { 0% { transform: translateY(-6px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cd-logo-badge, .cd-tick, .cd-line { animation: none; } }

@media (max-width: 720px) {
  .cd-sale { grid-template-columns: 1fr; }
}
`;
