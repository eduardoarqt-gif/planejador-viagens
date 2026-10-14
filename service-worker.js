const CACHE = "planejador-viagens-v24";
const ASSETS = ["./", "./index.html", "./styles.css?v=24", "./app.js?v=24", "./core.js?v=24", "./data.js?v=24", "./ui.js?v=24", "./services.js?v=24", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.hostname.endsWith("github.com") || url.hostname.includes("open-meteo") || url.hostname.includes("er-api") || url.hostname.includes("nominatim")) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok || response.type === "opaque") {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
