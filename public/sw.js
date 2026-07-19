/* Stookii service worker — enables "Install app" and keeps the till usable if
   the connection blips. Network-FIRST everywhere (a POS must show live data);
   only the page shell is cached, as an offline fallback so the screen is never
   blank. API calls are never cached. */
const SHELL = "stookii-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin through
  if (url.pathname.startsWith("/api/")) return; // never cache live data

  // Page navigations: try the network, fall back to the last cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
    );
  }
});
