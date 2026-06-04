// Service worker — offline-first app shell cache.
// Bump CACHE on any asset change to force clients to refresh.
const CACHE = 'blockblast-v9';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'engine.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // tolerant precache: don't let one missing asset block the whole update
      await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Network-first for page navigations so a fresh deploy is picked up when
  // online; fall back to the cached shell when offline.
  const isNav = req.mode === 'navigate' || (req.destination === 'document');
  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((c) => c || caches.match('.'))),
    );
    return;
  }

  // Stale-while-revalidate for static assets: serve the cache instantly for
  // speed + offline, but refresh it in the background so a new deploy is picked
  // up on the next load even if the CACHE version wasn't bumped.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
