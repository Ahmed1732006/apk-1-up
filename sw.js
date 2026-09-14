const CACHE_NAME = 'in-the-void-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './2.html',
  './app/index.html',
  './offline.html',
  './1.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest',
  './vendor/supabase-js.min.js',
  './vendor/gsap.min.js',
  './vendor/gsap-draggable.min.js',
  './vendor/jszip.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/google-fonts.css',
  './vendor/fontawesome.css',
  './app/theme-common.js',
  './app/theme-system.js',
  './midad-round5.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const isNavigation = req.mode === 'navigate';

  event.respondWith(
    fetch(req)
      .then(res => {
        try {
          const url = new URL(req.url);
          if (url.origin === self.location.origin && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
          }
        } catch (_) {}
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isNavigation) {
          return (await caches.match('./app/index.html')) ||
                 (await caches.match('./index.html')) ||
                 new Response('لا يوجد اتصال بالإنترنت', {
                   status: 503,
                   headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                 });
        }
        // Never return an HTML error page for failed JS/CSS/image/data requests.
        // That prevents a network failure from surfacing as raw HTML source.
        return new Response('', { status: 503, statusText: 'Offline' });
      })
  );
});

