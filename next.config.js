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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
