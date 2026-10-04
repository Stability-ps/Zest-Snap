// Generated into public/sw.js by scripts/prepare-sw.mjs; the version changes on every build.
const CACHE = "zest-snap-shell-__ZEST_SW_VERSION__";
// Only static, user-agnostic resources are cached. API responses and auth routes never are,
// so signing out or switching accounts cannot expose another person's data from this cache.
const SHELL = ["/app", "/settings", "/offline", "/manifest.webmanifest"];
const ICONS = [
  "/icons/zest-snap-192.png",
  "/icons/zest-snap-512.png",
  "/icons/zest-snap-maskable-512.png",
];
const SHELL_PAGES = ["/app", "/settings", "/offline"];

async function cacheAssetsFrom(cache, response) {
  const html = await response.text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&")),
    ),
  ];
  await Promise.allSettled(
    assets.map(async (src) => {
      const r = await fetch(src);
      if (r.ok) await cache.put(src, r);
    }),
  );
}

self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The offline page is required; everything else is best effort so one flaky asset cannot block updates.
      const offline = await fetch("/offline", { cache: "reload" });
      if (!offline.ok) throw new Error("Offline page unavailable");
      await cache.put("/offline", offline);
      await Promise.allSettled(
        [...SHELL.filter((p) => p !== "/offline"), ...ICONS].map(async (path) => {
          const response = await fetch(path, { cache: "reload" });
          if (!response.ok) return;
          await cache.put(path, response.clone());
          if (path === "/app" || path === "/settings") await cacheAssetsFrom(cache, response);
        }),
      );
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
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  )
    return;
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(req);
          // Keep the offline copy of the app shell current (static HTML, no user data).
          if (response.ok && SHELL_PAGES.includes(url.pathname)) {
            const cache = await caches.open(CACHE);
            await cache.put(url.pathname, response.clone());
          }
          return response;
        } catch {
          return (
            (SHELL_PAGES.includes(url.pathname) && (await caches.match(url.pathname))) ||
            (await caches.match("/offline")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))
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
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {}
  const title = payload.title || "Zest Snap";
  const body = payload.body || "You have an upcoming item.";
  const url = payload.url || "/app?view=planner";
  const reminderId = payload.reminderId || null;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/zest-snap-192.png",
      badge: "/icons/zest-snap-192.png",
      tag: payload.tag || "zest-reminder",
      renotify: true,
      // Sound and vibration are ultimately controlled by the device and browser settings.
      vibrate: [180, 80, 180],
      data: { url, reminderId },
      actions: reminderId
        ? [
            { action: "snooze", title: "Snooze 15 min" },
            { action: "done", title: "Done" },
          ]
        : [],
    }),
  );
});

async function focusOrOpen(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((c) => new URL(c.url).origin === self.location.origin && "focus" in c);
  if (existing) {
    // The open app switches views itself; no full reload, no lost state.
    existing.postMessage({ type: "zest-open", url });
    return existing.focus();
  }
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = event.notification.data?.url || "/app?view=planner";
  const id = event.notification.data?.reminderId;
  const action = event.action === "snooze" || event.action === "done" ? event.action : null;
  event.waitUntil(
    (async () => {
      if (action && id) {
        try {
          const response = await fetch("/api/reminders/action", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, action, minutes: 15 }),
          });
          if (response.ok) {
            const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            windows.forEach((c) => c.postMessage({ type: "zest-reminders-changed" }));
            return;
          }
        } catch {}
        // Session expired or offline: open the app, which completes the action after sign-in.
        return focusOrOpen(
          `/app?view=planner&tab=reminders&reminderAction=${action}&reminderId=${encodeURIComponent(id)}`,
        );
      }
      return focusOrOpen(base);
    })(),
  );
});
