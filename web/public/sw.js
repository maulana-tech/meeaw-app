const CACHE = "meaw-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(OFFLINE, { cache: "reload", credentials: "omit" });
    if (!response.ok) throw new Error("Offline page unavailable");
    const cache = await caches.open(CACHE);
    await cache.put(OFFLINE, response);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("meaw-offline-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  // Account HTML, notes and API responses never enter the PWA cache.
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(OFFLINE) ?? new Response("Meaw is offline. Reconnect and reload to continue.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
