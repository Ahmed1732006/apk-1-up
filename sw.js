const CACHE_NAME = 'in-the-void-shell-v4';
const APP_SHELL = [
  './', './index.html', './2.html', './app/index.html', './offline.html',
  './1.png', './icon-192.png', './icon-512.png', './manifest.webmanifest',
  './vendor/supabase-js.min.js', './vendor/gsap.min.js', './vendor/gsap-draggable.min.js',
  './vendor/jszip.min.js', './vendor/pdf-lib.min.js', './vendor/google-fonts.css', './vendor/fontawesome.css',
  './app/theme-common.js', './app/theme-system.js', './midad-round5.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const isNavigation = req.mode === 'navigate';
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (_) {}

  // Navigation is cache-first. A cached shell is returned immediately;
  // network revalidation is deliberately background-only and can never delay paint.
  if (isNavigation) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const fallback = cached || await caches.match('./app/index.html') || await caches.match('./index.html');
      if (fallback) {
        if (sameOrigin) {
          event.waitUntil(fetch(req).then(res => {
            if (res.ok) return caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
            return null;
          }).catch(() => null));
        }
        return fallback;
      }
      try { return await fetch(req); }
      catch (_) {
        return new Response('لا يوجد اتصال بالإنترنت', {
          status: 503, headers: {'Content-Type':'text/plain; charset=utf-8'}
        });
      }
    })());
    return;
  }

  // Same-origin packaged resources are also cache-first. This prevents CSS/JS/
  // fonts/images from triggering network timeouts while the app is offline.
  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        event.waitUntil(fetch(req).then(res => {
          if (res.ok) return caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return null;
        }).catch(() => null));
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) event.waitUntil(caches.open(CACHE_NAME).then(c => c.put(req, res.clone())).catch(() => null));
        return res;
      } catch (_) {
        return new Response('', {status:503, statusText:'Offline'});
      }
    })());
  }
});
