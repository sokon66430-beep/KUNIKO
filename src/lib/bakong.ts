import QRCode from "qrcode";
// bakong-khqr is CommonJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BakongKHQR, khqrData, IndividualInfo } = require("bakong-khqr");

/**
 * Bakong KHQR integration.
 *
 * LIVE mode  — requires BAKONG_ACCOUNT_ID (+ token to confirm payment).
 * SIM  mode  — no account configured: still generates a scannable demo QR so the
 *              full checkout flow can be tested, and payment is confirmed via the
 *              /simulate endpoint instead of the real Bakong API.
 *
 * Configure in .env.local (see .env.local.example).
 */

export type KhqrMode = "live" | "sim";

const ACCOUNT_ID = process.env.BAKONG_ACCOUNT_ID?.trim() || "";
const MERCHANT_NAME = process.env.BAKONG_MERCHANT_NAME?.trim() || "Stookii Store";
const MERCHANT_CITY = process.env.BAKONG_MERCHANT_CITY?.trim() || "Phnom Penh";
const API_TOKEN = process.env.BAKONG_API_TOKEN?.trim() || "";
const API_BASE = process.env.BAKONG_API_BASE?.trim() || "https://api-bakong.nbc.gov.kh";

export function khqrMode(): KhqrMode {
  return ACCOUNT_ID && API_TOKEN ? "live" : "sim";
}

export function bakongConfig() {
  return {
    mode: khqrMode(),
    accountId: ACCOUNT_ID || "demo@stookii",
    merchantName: MERCHANT_NAME,
    merchantCity: MERCHANT_CITY,
    hasAccount: !!ACCOUNT_ID,
    hasToken: !!API_TOKEN,
  };
}

/** In-process store of md5 -> paid, used only in SIM mode. */
const simPaid = new Set<string>();
export function markSimPaid(md5: string) {
  simPaid.add(md5);
}

export type GeneratedKhqr = {
  qr: string;
  md5: string;
  qrImage: string; // data URL (PNG)
  amount: number;
  currency: "USD" | "KHR";
  expiresAt: number;
  mode: KhqrMode;
  accountId: string;
  merchantName: string;
};

export async function generateKhqr(opts: {
  amount: number;
  currency?: "USD" | "KHR";
  billNumber?: string;
  ttlMs?: number;
}): Promise<GeneratedKhqr> {
  const currency = opts.currency || "USD";
  const cfg = bakongConfig();
  const expiresAt = Date.now() + (opts.ttlMs ?? 5 * 60 * 1000);

  const info = new IndividualInfo(cfg.accountId, cfg.merchantName, cfg.merchantCity, {
    amount: Number(opts.amount.toFixed(2)),
    currency: currency === "USD" ? khqrData.currency.usd : khqrData.currency.khr,
    billNumber: opts.billNumber || undefined,
    storeLabel: cfg.merchantName,
    terminalLabel: "POS-1",
    expirationTimestamp: expiresAt,
  });

  const res = new BakongKHQR().generateIndividual(info);
  if (res?.status?.code !== 0 || !res?.data?.qr) {
    throw new Error(res?.status?.message || "Failed to generate KHQR");
  }

  const qrImage = await QRCode.toDataURL(res.data.qr, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });

  return {
    qr: res.data.qr,
    md5: res.data.md5,
    qrImage,
    amount: Number(opts.amount.toFixed(2)),
    currency,
    expiresAt,
    mode: cfg.mode,
    accountId: cfg.accountId,
    merchantName: cfg.merchantName,
  };
}

export type PaymentStatus = {
  paid: boolean;
  mode: KhqrMode;
  message?: string;
  authError?: boolean;
};

/**
 * Check whether a KHQR (identified by its md5) has been paid.
 * LIVE: calls Bakong Open API. SIM: checks the in-process simulate store.
 */
export async function checkKhqrPaid(md5: string): Promise<PaymentStatus> {
  const mode = khqrMode();
  if (mode === "sim") {
    return { paid: simPaid.has(md5), mode };
  }

  try {
    const res = await fetch(`${API_BASE}/v1/check_transaction_by_md5`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({ md5 }),
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      return { paid: false, mode, authError: true, message: "Bakong token invalid or expired" };
    }

    const body = await res.json().catch(() => ({}));
    // responseCode 0 => transaction found (paid). Anything else => still pending.
    const paid = body?.responseCode === 0;
    return { paid, mode, message: body?.responseMessage };
  } catch (e: any) {
    // Network hiccup: treat as still-pending so polling continues gracefully.
    return { paid: false, mode, message: e?.message };
  }
}
