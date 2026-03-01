/* kAIxu CodeStudio - Offline PWA Service Worker */
const VERSION = "v1.0.1";
const CACHE_NAME = `kaixu-codestudio-${VERSION}`;

// Local files (always cache)
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./assets/logo.png",
  "./assets/bg.jpeg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-512-maskable.png"
];

// External libraries (cached at runtime; also attempted during install)
const EXTERNAL_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/react@18.2.0/umd/react.development.js",
  "https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined",
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
];

async function safePut(cache, key, response) {
  try { await cache.put(key, response); } catch(e) {}
}

async function fetchForCache(url) {
  // Try CORS first (best for <script crossorigin>), then fall back to no-cors (opaque).
  try {
    return await fetch(new Request(url, { mode: "cors", credentials: "omit" }));
  } catch (e) {
    return await fetch(new Request(url, { mode: "no-cors" }));
  }
}

async function precacheExternal(cache) {
  for (const url of EXTERNAL_ASSETS) {
    try {
      const res = await fetchForCache(url);
      // Cache successful or opaque responses
      if (res && (res.ok || res.type === "opaque")) {
        await safePut(cache, url, res);
      }
    } catch (e) {
      // ignore individual failures; runtime caching will handle remaining
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await precacheExternal(cache);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Ignore browser extensions / non-http(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Navigation: serve cached shell when offline
    if (req.mode === "navigate") {
      try {
        const net = await fetch(req);
        await safePut(cache, "./index.html", net.clone());
        return net;
      } catch (e) {
        return (await cache.match("./index.html")) || (await cache.match("./offline.html"));
      }
    }

    // Cache-first for everything else
    let cached = await cache.match(req, { ignoreVary: true });
    if (!cached) cached = await cache.match(req.url, { ignoreVary: true });
    if (cached) return cached;

    // Network then cache
    try {
      const net = await fetch(req);
      if (net && (net.ok || net.type === "opaque")) {
        await safePut(cache, req, net.clone());
        await safePut(cache, req.url, net.clone());
      }
      return net;
    } catch (e) {
      const accept = req.headers.get("accept") || "";
      if (accept.includes("text/html")) {
        return (await cache.match("./index.html")) || (await cache.match("./offline.html"));
      }
      throw e;
    }
  })());
});
