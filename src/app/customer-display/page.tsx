"use client";

import { useEffect, useRef, useState } from "react";
import { Check, QrCode, ShoppingBag } from "lucide-react";
import { usd, riel, num } from "@/lib/format";
import {
  type CDState,
  readCustomerDisplay,
  subscribeCustomerDisplay,
} from "@/lib/customerDisplay";

// The second screen on the Sunmi T3. Read-only mirror of the cashier's till,
// kept in step by lib/customerDisplay. Big type, high contrast, bilingual — it
// faces the customer, not the operator.
export default function CustomerDisplayPage() {
  const [state, setState] = useState<CDState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState(readCustomerDisplay());
    return subscribeCustomerDisplay(setState);
  }, []);

  // Keep the newest scanned line in view as the basket grows.
  useEffect(() => {
    if (state?.kind === "sale" && listRef.current) listRef.current.scrollTop = 0;
  }, [state]);

  const storeName =
    (state && "storeName" in state && state.storeName) || "ON Mart";

  return (
    <div className="cd-root">
      <style>{CSS}</style>

      <header className="cd-top">
        <span className="cd-brand">
          <ShoppingBag size={26} strokeWidth={2.4} />
          {storeName}
        </span>
        {state?.kind === "sale" && (
          <span className="cd-count">
            {num(state.itemCount)} item{state.itemCount === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {(!state || state.kind === "idle") && <Idle storeName={storeName} />}
      {state?.kind === "sale" && <Sale state={state} listRef={listRef} />}
      {state?.kind === "khqr" && <Khqr state={state} />}
      {state?.kind === "thanks" && <Thanks state={state} />}
    </div>
  );
}

function Idle({ storeName }: { storeName: string }) {
  return (
    <div className="cd-center cd-idle">
      <div className="cd-logo">
        <ShoppingBag size={72} strokeWidth={2} />
      </div>
      <h1>{storeName}</h1>
      <p className="cd-welcome">Welcome · សូមស្វាគមន៍</p>
      <p className="cd-sub">Please hand your items to our cashier</p>
    </div>
  );
}

function Sale({
  state,
  listRef,
}: {
  state: Extract<CDState, { kind: "sale" }>;
  listRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="cd-sale">
      <div className="cd-list" ref={listRef}>
        {state.lines.length === 0 ? (
          <p className="cd-empty">Scanning…</p>
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

      <aside className="cd-totalpane">
        {state.discount > 0 && (
          <div className="cd-disc">
            <span>Discount</span>
            <span>−{usd(state.discount)}</span>
          </div>
        )}
        <div className="cd-totlabel">Total to pay</div>
        <div className="cd-tot">{usd(state.total)}</div>
        <div className="cd-riel">{riel(state.total)}</div>
        <div className="cd-vat">VAT 10% included</div>
      </aside>
    </div>
  );
}

function Khqr({ state }: { state: Extract<CDState, { kind: "khqr" }> }) {
  return (
    <div className="cd-center cd-khqr">
      <div className="cd-khqr-head">
        <QrCode size={30} strokeWidth={2.4} />
        Scan to pay · បង់ប្រាក់
      </div>
      {state.qrImage ? (
        <img src={state.qrImage} alt="KHQR payment code" className="cd-qrimg" />
      ) : (
        <div className="cd-qrimg cd-qr-wait">Loading…</div>
      )}
      <div className="cd-khqr-amt">{usd(state.amount)}</div>
      <p className="cd-sub">Open any bank app — ABA, Wing, Bakong — and scan</p>
    </div>
  );
}

function Thanks({ state }: { state: Extract<CDState, { kind: "thanks" }> }) {
  const hasChange = typeof state.change === "number" && state.change > 0.0001;
  return (
    <div className="cd-center cd-thanks">
      <div className="cd-tick">
        <Check size={64} strokeWidth={3} />
      </div>
      <h1>Thank you</h1>
      <p className="cd-welcome">អរគុណ</p>
      {hasChange && (
        <div className="cd-change">
          <div className="cd-change-l">Your change</div>
          <div className="cd-change-v">{usd(state.change as number)}</div>
          <div className="cd-change-r">{riel(state.change as number)}</div>
        </div>
      )}
      <p className="cd-sub">Paid {usd(state.total)} · {state.method}</p>
    </div>
  );
}

const CSS = `
.cd-root {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: #0e1526; color: #f4f6fb;
  font-family: var(--font-sans), ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  overflow: hidden;
}
.cd-top {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 20px 34px; background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.cd-brand { display: inline-flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; color: #fff; }
.cd-brand svg { color: #6ea0ff; }
.cd-count { font-size: 18px; font-weight: 600; color: #9fb0cc; }

.cd-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px; }
.cd-sub { margin: 0; font-size: clamp(18px, 2.2vw, 26px); color: #9fb0cc; }

/* Idle */
.cd-logo { color: #6ea0ff; opacity: 0.9; }
.cd-idle h1 { margin: 4px 0 0; font-size: clamp(44px, 6vw, 76px); font-weight: 800; letter-spacing: -0.02em; }
.cd-welcome { margin: 0; font-size: clamp(24px, 3vw, 38px); font-weight: 700; color: #6ea0ff; }

/* Sale — item list + total pane */
.cd-sale { flex: 1; display: grid; grid-template-columns: 1fr 40%; min-height: 0; }
.cd-list { overflow-y: auto; padding: 22px 30px; display: flex; flex-direction: column; gap: 2px; }
.cd-empty { color: #7f8eaa; font-size: 28px; margin: auto; }
.cd-line { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: 16px; padding: 15px 6px; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: clamp(20px, 2.3vw, 30px); }
.cd-qty { font-weight: 700; color: #6ea0ff; font-variant-numeric: tabular-nums; min-width: 3ch; }
.cd-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-name em { font-style: normal; color: #9fb0cc; font-weight: 500; }
.cd-lt { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

.cd-totalpane { background: linear-gradient(180deg,#13203a,#0f1a30); border-left: 1px solid rgba(255,255,255,0.09); display: flex; flex-direction: column; justify-content: center; align-items: flex-end; text-align: right; padding: 30px 40px; gap: 4px; }
.cd-disc { width: 100%; display: flex; justify-content: space-between; font-size: 24px; color: #ff9ec4; font-weight: 700; margin-bottom: 14px; }
.cd-totlabel { font-size: clamp(18px, 2vw, 24px); color: #9fb0cc; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
.cd-tot { font-size: clamp(56px, 9vw, 132px); font-weight: 800; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; color: #fff; }
.cd-riel { font-size: clamp(24px, 3vw, 40px); font-weight: 700; color: #6ea0ff; font-variant-numeric: tabular-nums; margin-top: 4px; }
.cd-vat { font-size: 16px; color: #7f8eaa; margin-top: 8px; }

/* KHQR */
.cd-khqr-head { display: inline-flex; align-items: center; gap: 12px; font-size: clamp(24px,3vw,34px); font-weight: 800; color: #fff; }
.cd-khqr-head svg { color: #6ea0ff; }
.cd-qrimg { width: min(46vh, 440px); height: min(46vh, 440px); border-radius: 20px; background: #fff; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
.cd-qr-wait { display: flex; align-items: center; justify-content: center; color: #0e1526; font-size: 24px; font-weight: 700; }
.cd-khqr-amt { font-size: clamp(44px, 7vw, 92px); font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

/* Thanks */
.cd-tick { width: 128px; height: 128px; border-radius: 999px; background: #12b76a; display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 0 0 12px rgba(18,183,106,0.18); }
.cd-thanks h1 { margin: 8px 0 0; font-size: clamp(48px, 7vw, 88px); font-weight: 800; letter-spacing: -0.02em; }
.cd-change { margin-top: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 22px; padding: 22px 44px; }
.cd-change-l { font-size: 22px; color: #9fb0cc; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
.cd-change-v { font-size: clamp(48px, 8vw, 104px); font-weight: 800; letter-spacing: -0.02em; color: #12b76a; font-variant-numeric: tabular-nums; line-height: 1.05; }
.cd-change-r { font-size: clamp(22px,3vw,34px); font-weight: 700; color: #6ea0ff; font-variant-numeric: tabular-nums; }

@media (max-width: 720px) {
  .cd-sale { grid-template-columns: 1fr; }
  .cd-totalpane { border-left: 0; border-top: 1px solid rgba(255,255,255,0.09); align-items: center; text-align: center; }
}
`;
