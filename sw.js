/* RoadSense offline shell. Không cache yêu cầu GitHub hay dữ liệu API cá nhân. */
const CACHE_NAME = 'roadsense-drivefusion-v1-20261027';
const SHELL = [
  './index.html', './style.css', './archive.js', './road-memory.js', './driving.js', './script.js', './manifest.json',
  './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('roadsense-') && k !== CACHE_NAME).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && (request.mode === 'navigate' || SHELL.some(path => new URL(path,self.registration.scope).href === request.url))) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request,response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const offline = await caches.match(new URL('./index.html',self.registration.scope).href);
        if (offline) return offline;
      }
      return Response.error();
    }
  })());
});
