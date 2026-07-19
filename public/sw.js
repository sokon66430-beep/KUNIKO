/* Stookii service worker — its only job is to make the app installable
   ("Install app" / "Add to Home Screen"). It does NOT cache anything: a POS
   must always show live data, and a cached page shell could serve a stale
   screen after a deploy. So it just passes navigations straight to the network. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  // Drop any shell cached by an older version of this worker.
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  // A fetch handler is required for installability. Network pass-through only.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
  }
});
