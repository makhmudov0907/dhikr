/* Bump VERSION whenever a file in APP_FILES changes. Upload the whole package. */
const VERSION = '2026-11-18-1';
const APP_BASE = new URL('./', self.location.href);
const CACHE_PREFIX = 'dhikr-shell:' + APP_BASE.href + ':';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const INDEX_URL = new URL('./index.html', APP_BASE).href;
const APP_FILES = [
  './index.html',
  './style.css',
  './app.mjs',
  './logic.mjs',
  './pwa.mjs',
  './manifest.webmanifest',
  './assets/drop.svg',
  './assets/olive-dry.png',
  './assets/olive-lush.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png'
].map(file => new URL(file, APP_BASE).href);
const APP_URLS = new Set(APP_FILES);

self.addEventListener('install', event => {
  // Installation succeeds only after every essential file is cached. A failed
  // download leaves an older installed version available, if one exists.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map(url => new Request(url, {cache:'reload'})));
  })());
  // No skipWaiting: an update must not replace the version used by an open counter.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function fromAppCache(key, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key);
  if (cached) return cached;
  // A browser can evict cached files. Network recovery does not alter saved counts.
  return fetch(request);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_BASE.origin || !url.pathname.startsWith(APP_BASE.pathname)) return;

  const documentPath = new URL(INDEX_URL).pathname;
  if (request.mode === 'navigate' && (url.pathname === APP_BASE.pathname || url.pathname === documentPath)) {
    event.respondWith(fromAppCache(INDEX_URL, request));
    return;
  }

  // Cache only this release's known files. Other GitHub Pages projects, external
  // requests, and unknown routes are never stored or replaced with the app shell.
  url.search = '';
  url.hash = '';
  if (APP_URLS.has(url.href)) event.respondWith(fromAppCache(url.href, request));
});
