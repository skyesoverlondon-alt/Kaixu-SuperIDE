/* SignInPro PWA Service Worker
   Goal: Keep your ORIGINAL app logic/UI intact and make it installable + offline-capable.
   Strategy: cache-first for app shell + runtime caching for CDN dependencies.
*/

const CACHE_NAME = 'signinpro-executive-v1';

const LOCAL_CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './_headers',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// Remote dependencies your original HTML loads.
// We "warm" the cache when possible, but we ALSO cache on-demand during normal runtime.
const REMOTE_CORE = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://esm.sh/react@18.2.0',
  'https://esm.sh/react-dom@18.2.0/client',
  'https://esm.sh/lucide-react@0.292.0'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_CORE);

    // Warm-cache remote files best-effort (don’t fail install if a CDN hiccups).
    // Important: ESM modules generally require CORS-enabled responses (opaque can break module loading),
    // so we try CORS first, then fall back to no-cors.
    async function warm(url) {
      try {
        const res = await fetch(new Request(url, { mode: 'cors' }));
        await cache.put(url, res);
        return;
      } catch (e) {}
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        await cache.put(url, res);
      } catch (e) {}
    }
    await Promise.all(REMOTE_CORE.map(warm));

    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: false });
  if (cached) return cached;

  const res = await fetch(req);
  // Cache successful (including opaque) GET responses.
  try { await cache.put(req, res.clone()); } catch (e) {}
  return res;
}

async function networkFirstForNav(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    try { await cache.put('./index.html', res.clone()); } catch (e) {}
    return res;
  } catch (e) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // App navigations: always fall back to index.html offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstForNav(req));
    return;
  }

  // Everything else: cache-first (works for same-origin AND cross-origin CDN assets).
  event.respondWith((async () => {
    try {
      return await cacheFirst(req);
    } catch (e) {
      // Last resort: if it was a same-origin request, try index.
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match('./index.html');
      return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
