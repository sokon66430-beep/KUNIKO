// Edge-safe session crypto: uses the GLOBAL Web Crypto (crypto.subtle),
// available in both Edge middleware and Node route handlers. No `node:crypto`
// and no `next/headers` imports here, so middleware can import this safely.

export type Role = "owner" | "accountant" | "procurement" | "operations";

export type Session = {
  uid: string;
  storeId: string;
  storeName: string;
  role: Role;
  name: string;
  exp: number; // epoch seconds
};

export const SESSION_COOKIE = "kuon_session";
const SECRET = process.env.AUTH_SECRET || "kuon-dev-secret-change-in-production";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function signSession(s: Omit<Session, "exp"> & { exp?: number }): Promise<string> {
  const payload: Session = { ...s, exp: s.exp ?? Math.floor(Date.now() / 1000) + MAX_AGE };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, await hmac(body))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Session;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
