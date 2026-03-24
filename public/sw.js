const CACHE_NAME = 'tuna-v1';

const APP_SHELL = [
  './',
  './style.css',
  './favicon.svg',
  './assets/app.js',
  './assets/worklet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response.ok) {
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
