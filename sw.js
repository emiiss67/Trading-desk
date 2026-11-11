const SHELL = "desk-shell-v3";
const DATA = "desk-json-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/dom.js",
  "./js/text.js",
  "./js/format.js",
  "./js/link.js",
  "./js/settings.js",
  "./js/api.js",
  "./js/series.js",
  "./js/gecko.js",
  "./js/icons.js",
  "./js/effects.js",
  "./js/particles.js",
  "./js/charts.js",
  "./js/render.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL && key !== DATA).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set("x-desk-cached-at", String(Date.now()));
  return response.blob().then((body) => new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

async function networkFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const saved = await stamp(fresh.clone());
      await cache.put(request, saved);
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (!cached) throw err;
    const at = Number(cached.headers.get("x-desk-cached-at"));
    if (maxAge && (!Number.isFinite(at) || Date.now() - at > maxAge)) {
      return new Response("expired", { status: 504 });
    }
    return cached;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request, DATA, 20000));
    return;
  }
  const shell = SHELL_FILES.some((file) => url.pathname.endsWith(file.replace("./", "/")) || (file === "./" && url.pathname.endsWith("/")));
  if (shell || request.mode === "navigate") event.respondWith(networkFirst(request, SHELL, 0));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "purge-data") event.waitUntil(caches.delete(DATA));
});
