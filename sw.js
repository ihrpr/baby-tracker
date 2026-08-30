/**
 * Self-destructing service worker: the app has moved to tinyloops.app, so
 * this replaces the old caching worker on every installed device — it wipes
 * the shell cache, unregisters itself, and reloads open pages so they show
 * the migration notice instead of the cached app.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
