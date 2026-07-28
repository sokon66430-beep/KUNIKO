// Security headers applied to every response. Defense-in-depth on top of the
// auth/session layer:
//  - X-Frame-Options / frame-ancestors: block clickjacking (the app can't be
//    iframed by another site).
//  - X-Content-Type-Options: stop MIME-sniffing.
//  - Referrer-Policy: don't leak full URLs to third parties.
//  - HSTS: force HTTPS on the browser after the first visit (production only).
// A strict Content-Security-Policy is intentionally NOT set here: Next.js relies
// on inline bootstrap scripts and styled-jsx, so a wrong CSP would break the app
// on deploy with no local warning. Frame-ancestors 'none' covers the highest-
// value CSP win (clickjacking) without that risk.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for a small, fast Docker image.
  output: "standalone",
  // `pg` stays EXTERNAL (required by Node at runtime, never bundled) — bundling
  // it can drag Node built-ins like `fs` into a build that has no filesystem.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Never let a DEVICE keep a page's HTML.
      //
      // Next serves a prerendered page (/pos, /login and most of this app) with
      // `s-maxage=31536000, stale-while-revalidate` and no browser max-age, so a
      // client is free to cache it heuristically — and the Sunmi's WebView does,
      // on disk, for a long time.
      //
      // That HTML names its JavaScript by content hash. Every deploy changes
      // those hashes and deletes the old files, so a till holding yesterday's
      // HTML asks for chunks that no longer exist, gets 404s, and never boots
      // React. The page then sits forever on exactly what was prerendered — the
      // loading skeleton — and closing the app does not help, because the cache
      // is on disk. This was the "always loading" on the counter.
      //
      // The HTML is tiny and always comes from the server now. The hashed assets
      // below keep their year-long immutable cache, which is safe precisely
      // because their names change when their contents do.
      {
        source: "/:path((?!_next/static|_next/image|favicon).*)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

module.exports = nextConfig;
