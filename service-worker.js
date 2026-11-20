const CACHE_NAME = "mysupermarket-shell-v4";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [
  "/",
  "/index.html",
  "/product.html",
  "/cart_Version2.html",
  "/payment-success.html",
  "/supermarket-website_css_style_Version2.css",
  "/js_script_Version2.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/app-icon.png",
  "/app-icon-192.png",
  "/app-icon-512.png",
  "/products/apples.png",
  "/products/eggs.png",
  "/products/fresh-bread.png",
  "/products/fresh-milk.png",
  "/products/juice.png",
  "/products/rice.png",
  OFFLINE_URL,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match(url.pathname === "/" ? "/index.html" : OFFLINE_URL))));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
