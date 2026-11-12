const CACHE = "planejador-viagens-v63";
const ASSETS = ["./", "./index.html", "./styles.css?v=63", "./app.js?v=63", "./core.js?v=63", "./data.js?v=63", "./ui.js?v=63", "./services.js?v=63", "./mascaras.js?v=63", "./descobrir.js?v=63", "./voos.js?v=63", "./licenca.js?v=63", "./licenca_config.js?v=63", "./chave_publica_licenca.js?v=63", "./nacl-fast.min.js?v=63", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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
