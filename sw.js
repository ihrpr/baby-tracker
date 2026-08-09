/**
 * Service worker: cache the app shell so the app opens instantly (and shows
 * the last UI offline). Data requests go to Google's APIs and are never
 * cached — network-first keeps the app itself fresh after deploys.
 */

const CACHE = 'baby-tracker-v2';
const SHELL = [
  '.',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/config.js',
  'js/format.js',
  'js/google.js',
  'js/stats.js',
  'js/store.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // only same-origin GETs; Google auth/API traffic passes straight through
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })));
});
