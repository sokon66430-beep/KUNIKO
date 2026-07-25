"use client";

import { useEffect, useRef, useState } from "react";
import { Check, QrCode, ShoppingBag } from "lucide-react";
import { usd, riel, num, rielShelfPrice } from "@/lib/format";
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
  theme: "light",
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

  // Between customers — no sale, OR a sale with nothing scanned yet — the promo
  // pictures take the WHOLE screen (no receipt panel). The receipt only appears
  // once the first product is scanned.
  const idle =
    !state || state.kind === "idle" || (state.kind === "sale" && state.lines.length === 0);
  if (idle && c.ads.length > 0) {
    return (
      <div className="cd-root" style={vars}>
        <style>{CSS}</style>
        <AdSlides ads={c.ads} seconds={c.adSeconds} full />
      </div>
    );
  }

  // While scanning (at least one item): full-screen split like the store's own
  // display — the advertisement on the LEFT, the order receipt on the RIGHT.
  if (state?.kind === "sale" && state.lines.length > 0) {
    return (
      <div className="cd-root" style={vars}>
        <style>{CSS}</style>
        <SaleScreen state={state} c={c} storeName={storeName} logo={cfg?.logo} showRiel={showRiel} listRef={listRef} />
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
      </header>

      {idle && <Idle storeName={storeName} c={c} logo={cfg?.logo} />}
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

// The scanning screen, matching the store's own display: the ADVERTISEMENT on
// the left, the ORDER RECEIPT (store name, a Product / Price / Qty / Amount
// table, then the Payment + totals block) on the right.
function SaleScreen({
  state,
  c,
  storeName,
  logo,
  showRiel,
  listRef,
}: {
  state: Extract<CDState, { kind: "sale" }>;
  c: typeof DEFAULTS;
  storeName: string;
  logo?: string;
  showRiel: boolean;
  listRef: React.RefObject<HTMLDivElement>;
}) {
  const hasAds = (c.ads || []).length > 0;
  const subtotal = Math.round((state.total + state.discount) * 100) / 100;

  return (
    <div className="cd-screen">
      {/* LEFT — the advertisement (store branding until pictures are added). */}
      <div className="cd-adcol">
        {hasAds ? (
          <AdSlides ads={c.ads} seconds={c.adSeconds} />
        ) : (
          <div className="cd-brandad">
            <div className="cd-logo-badge">
              {logo && c.showLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="cd-idle-logo" />
              ) : (
                <ShoppingBag size={72} strokeWidth={2} />
              )}
            </div>
            <div className="cd-brandpane-name">{storeName}</div>
            {c.welcomeLine && <div className="cd-brandpane-sub">{c.welcomeLine}</div>}
          </div>
        )}
      </div>

      {/* RIGHT — the order receipt. */}
      <div className="cd-receipt">
        <div className="cd-r-head">{storeName}</div>

        <div className="cd-r-hrow">
          <span>Product</span>
          <span>Price</span>
          <span>Qty</span>
          <span>Amount</span>
        </div>
        <div className="cd-r-rows" ref={listRef}>
          {state.lines.length === 0 ? (
            <p className="cd-r-empty">Scanning…</p>
          ) : (
            state.lines.map((l, i) => {
              const unit = l.qty ? l.lineTotal / l.qty : l.lineTotal;
              return (
                <div className="cd-r-row" key={i}>
                  <span className="cd-r-name">
                    {l.name}
                    {l.unitLabel ? ` · ${l.unitLabel}` : ""}
                  </span>
                  {/* Riel is the main figure (rounded up to 100៛), the dollar
                      small beneath it. */}
                  <span className="cd-r-num cd-r-money">
                    <b>៛{num(rielShelfPrice(unit))}</b>
                    <em>{usd(unit)}</em>
                  </span>
                  <span className="cd-r-num">{num(l.qty)}</span>
                  <span className="cd-r-num cd-r-money cd-r-amt">
                    <b>៛{num(rielShelfPrice(l.lineTotal))}</b>
                    <em>{usd(l.lineTotal)}</em>
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="cd-r-foot">
          <div className="cd-r-col">
            <div><span>Payment</span><span>—</span></div>
            <div><span>Received</span><span>{usd(0)}</span></div>
            <div className="cd-r-strong"><span>Remain</span><span>{usd(state.total)}</span></div>
          </div>
          <div className="cd-r-col">
            <div><span>Subtotal</span><span>{usd(subtotal)}</span></div>
            <div><span>Discount</span><span>{usd(state.discount)}</span></div>
            <div className="cd-r-grand"><span>Total</span><span>{usd(state.total)}</span></div>
            {/* Riel rounded UP to the nearest 100 — Cambodia has no coins below
                100៛, so the customer-facing riel is always a whole hundred. */}
            {showRiel && <div className="cd-r-khr"><span>KHR</span><span>៛{num(rielShelfPrice(state.total))}</span></div>}
          </div>
        </div>
      </div>
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

/* Sale: 40% basket + total (LEFT) | 60% advertising or branding (RIGHT) */
.cd-sale { flex: 1; display: grid; grid-template-columns: 2fr 3fr; min-height: 0; gap: 14px; padding: 12px 18px 20px; }
.cd-buy { display: flex; flex-direction: column; min-height: 0; gap: 12px; }
.cd-buy .cd-list { flex: 1; }
.cd-buy .cd-totcard { flex: 0 0 auto; }

/* Advertising pane fills its whole 60% (cropping to fit) */
.cd-adpane { position: relative; min-height: 0; }
.cd-adpane-img { width: 100%; height: 100%; object-fit: cover; border-radius: 24px; box-shadow: var(--cd-shadow); display: block; }
.cd-adpane .cd-dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); margin: 0; }

/* Branding shown in the 60% when there are no promo pictures yet */
.cd-brandpane {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  background: var(--cd-soft2); border: 1.5px solid var(--cd-soft); border-radius: 28px; box-shadow: var(--cd-shadow);
}
.cd-brandpane-name { font-size: clamp(30px, 4vw, 56px); font-weight: 800; letter-spacing: -0.02em; }
.cd-brandpane-sub { font-size: clamp(18px, 2vw, 30px); font-weight: 700; color: var(--cd-accent); }

/* Item list — PLAIN rows (no card box), a thin divider between them */
.cd-list { overflow-y: auto; padding: 2px 2px; display: flex; flex-direction: column; }
.cd-empty { color: var(--cd-muted); font-size: 22px; font-weight: 600; margin: auto; }
.cd-line {
  display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 16px;
  padding: 13px 8px; border-bottom: 1px solid var(--cd-border);
  font-size: clamp(15px, 1.5vw, 22px);
  animation: cd-slide 0.28s ease;
}
.cd-item { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.cd-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-name em { font-style: normal; color: var(--cd-muted); font-weight: 500; }
.cd-each { font-size: 0.66em; color: var(--cd-muted); font-weight: 500; }
.cd-qtynum { font-weight: 800; color: var(--cd-accent); font-variant-numeric: tabular-nums; min-width: 1.6em; text-align: center; }
.cd-lt { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

.cd-totcard {
  background: var(--cd-soft2); border: 1.5px solid var(--cd-soft);
  border-radius: 24px; display: flex; flex-direction: column; justify-content: center; align-items: center;
  text-align: center; padding: 22px; box-shadow: var(--cd-shadow);
}
.cd-disc { display: flex; gap: 12px; align-items: center; font-size: 20px; color: #e05a97; font-weight: 800; margin-bottom: 12px; background: var(--cd-card); padding: 6px 16px; border-radius: 999px; }
.cd-totlabel { font-size: clamp(15px, 1.6vw, 21px); color: var(--cd-muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
.cd-tot { font-size: clamp(48px, 7vw, 104px); font-weight: 800; letter-spacing: -0.035em; line-height: 1; font-variant-numeric: tabular-nums; color: var(--cd-fg); margin: 4px 0; }
.cd-riel { font-size: clamp(22px, 2.6vw, 36px); font-weight: 800; color: var(--cd-accent); font-variant-numeric: tabular-nums; background: var(--cd-soft); padding: 5px 16px; border-radius: 999px; }
.cd-vat { font-size: 14px; color: var(--cd-muted); margin-top: 10px; }

/* ── Scanning screen: advertisement LEFT | order receipt RIGHT ──────────── */
.cd-screen { position: fixed; inset: 0; display: grid; grid-template-columns: 1.8fr 1fr; background: var(--cd-bg); }
.cd-adcol { position: relative; display: flex; overflow: hidden; background: #000; }
.cd-adcol .cd-adpane { flex: 1; }
.cd-adcol .cd-adpane-img { border-radius: 0; box-shadow: none; }
.cd-brandad { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: var(--cd-bg); color: var(--cd-fg); }
/* The receipt reads like a paper slip — light panel, dark ink — matching the store's display. */
.cd-receipt { display: flex; flex-direction: column; background: #ffffff; color: #1a2338; padding: 30px 26px 28px; min-height: 0; }
.cd-r-head { font-size: clamp(20px, 2.1vw, 30px); font-weight: 800; letter-spacing: 0; color: #1a2338; padding-bottom: 18px; }
/* Columns in REM (not em) so the small-font header and larger-font rows share
   the exact same column widths — otherwise Price/Qty/Amount don't line up. */
.cd-r-hrow, .cd-r-row { display: grid; grid-template-columns: 1fr 5rem 2rem 5.4rem; gap: 8px; align-items: center; }
.cd-r-hrow { color: #9aa5bd; font-weight: 600; font-size: clamp(11px, 1vw, 13px); text-transform: uppercase; letter-spacing: 0.05em; padding: 0 0 12px; border-bottom: 1px solid #edf0f5; }
.cd-r-hrow span:not(:first-child) { text-align: right; }
.cd-r-rows { flex: 1; overflow-y: auto; min-height: 0; }
.cd-r-row { padding: 14px 0; border-bottom: 1px solid #f4f6f9; font-size: clamp(13px, 1.15vw, 17px); }
/* Product name may wrap to two lines so it's never cut mid-word. */
.cd-r-name { font-weight: 600; color: #1a2338; overflow: hidden; line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.cd-r-num { text-align: right; font-variant-numeric: tabular-nums; color: #55617b; }
.cd-r-amt { font-weight: 700; color: #1a2338; }
/* Riel as the main figure, the dollar small underneath (right-aligned). */
.cd-r-money { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; gap: 1px; }
.cd-r-money b { font-weight: 700; color: #1a2338; }
.cd-r-money em { font-style: normal; font-size: 0.72em; font-weight: 500; color: #949db2; }
.cd-r-num.cd-r-money { color: #1a2338; }
.cd-r-empty { color: #aab3c6; font-size: 20px; padding: 26px 0; }
.cd-r-foot { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #e4e8ef; padding-top: 20px; margin-top: 8px; }
.cd-r-col { display: flex; flex-direction: column; gap: 10px; padding: 0 26px; min-width: 0; }
.cd-r-col:first-child { padding-left: 0; }
.cd-r-col:last-child { padding-right: 0; border-left: 1px solid #edf0f5; }
.cd-r-col > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: clamp(13px, 1.2vw, 16px); color: #7a869e; font-variant-numeric: tabular-nums; }
.cd-r-col > div > span:last-child { white-space: nowrap; }
.cd-r-strong span, .cd-r-grand span { color: #1a2338; font-weight: 800; }
.cd-r-grand { font-size: clamp(19px, 1.9vw, 25px); border-top: 1px solid #edf0f5; margin-top: 5px; padding-top: 11px; }
.cd-r-khr span { color: #2549e8; font-weight: 800; }

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
