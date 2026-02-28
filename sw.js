// Service worker for kAIxU IDE
//
// This service worker performs two tasks:
//  1. It caches the application shell (HTML, CSS, JS) so the IDE
//     functions offline once loaded.
//  2. It intercepts fetch requests beginning with `/virtual/` and
//     serves file contents out of IndexedDB.  This allows the preview
//     iframe to load multiple files (scripts, styles, images) from
//     the workspace as though they were served from a real server.

const APP_SHELL = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'jszip.min.js',
  'sw.js',
  'manifest.json'
];

// Bump the cache name to force service worker to fetch the latest app shell
const CACHE_NAME = 'kaixu-ide-shell-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches if names change in future
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

function getMimeType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'js':
      return 'application/javascript; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'svg':
      return 'image/svg+xml; charset=utf-8';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kaixu-workspace', 2);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function readFileFromDb(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const req = store.get(path);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Cache-first for app shell, virtual server for /virtual/*
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/virtual/')) {
    const filePath = decodeURIComponent(url.pathname.replace(/^\/virtual\//, ''));
    event.respondWith((async () => {
      // Serve index.html by default
      const p = filePath || 'index.html';
      const rec = await readFileFromDb(p);
      if (!rec) {
        return new Response('Not found', { status: 404 });
      }
      const mime = getMimeType(p);
      const content = String(rec.content || '');
      if (content.startsWith('__b64__:')) {
        const b64 = content.slice('__b64__:'.length);
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'Content-Type': mime } });
      }
      return new Response(content, { headers: { 'Content-Type': mime } });
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});