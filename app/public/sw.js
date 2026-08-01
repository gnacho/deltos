/*
 * Deltos — service worker (PWA offline).
 * - /api/*: network-only (nunca se cachea; el SSE y las mutaciones no pasan por aquí).
 * - Navegación (HTML): network-first, fallback a la última index cacheada (offline).
 * - /assets /fonts /icons /manifest: cache-first (Vite lleva hash → inmutable).
 * Actualización: el SW nuevo queda en waiting hasta que la UI manda SKIP_WAITING
 * (botón "Actualizar y recargar" en Ajustes → Acerca de) o se cierran las pestañas.
 */
const VERSION = 'v1';
const STATIC_CACHE = `deltos-static-${VERSION}`;
const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network-only

  // Navegación SPA: red primero (index.html fresco), caché si estamos offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() =>
          caches.match('/').then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Estáticos fingerprinted: caché primero, rellenar on-the-fly.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
