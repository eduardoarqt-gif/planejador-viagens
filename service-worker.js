const CACHE = "planejador-viagens-v64";
const ASSETS = ["./", "./index.html", "./styles.css?v=64", "./app.js?v=64", "./core.js?v=64", "./data.js?v=64", "./ui.js?v=64", "./services.js?v=64", "./mascaras.js?v=64", "./descobrir.js?v=64", "./voos.js?v=64", "./licenca.js?v=64", "./licenca_config.js?v=64", "./chave_publica_licenca.js?v=64", "./nacl-fast.min.js?v=64", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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
