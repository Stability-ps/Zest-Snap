const CACHE = "zest-snap-shell-v4";
const SHELL = [
  "/app",
  "/settings",
  "/offline",
  "/manifest.webmanifest",
  "/icons/zest-snap-192.png",
  "/icons/zest-snap-512.png",
  "/icons/zest-snap-maskable-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of SHELL) {
        const response = await fetch(path, { cache: "reload" });
        if (!response.ok) throw new Error("Shell unavailable");
        await cache.put(path, response.clone());
        if (path === "/app" || path === "/settings") {
          const html = await response.text();
          const assets = [
            ...new Set(
              [
                ...html.matchAll(
                  /(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g,
                ),
              ].map((m) => m[1].replaceAll("&amp;", "&")),
            ),
          ];
          await Promise.all(
            assets.map(async (src) => {
              const r = await fetch(src);
              if (r.ok) await cache.put(src, r);
            }),
          );
        }
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith("zest-snap-") && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (req.mode === "navigate") {
    if (!["/app", "/settings", "/offline"].includes(url.pathname)) return;
    event.respondWith(
      fetch(req).catch(
        async () =>
          (await caches.match(url.pathname)) ||
          (await caches.match("/offline")),
      ),
    );
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  )
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const response = await fetch(req);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(req, response.clone());
        }
        return response;
      })(),
    );
});
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("push", (event) => {
  if (!event.data) return;
  event.waitUntil(
    self.registration.showNotification("Zest Snap", {
      body: "You have an upcoming item. Open your agenda to review it.",
      icon: "/icons/zest-snap-192.png",
      data: { url: "/app?view=calendar" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/app?view=calendar"));
});
