/*
 * Deltos — service worker (PWA offline).
 * - /api/*: network-only (nunca se cachea; el SSE y las mutaciones no pasan por aquí).
 * - Navegación (HTML): network-first, fallback a la última index cacheada (offline).
 * - /assets /fonts /icons /manifest: cache-first (Vite lleva hash → inmutable).
 * Actualización: el SW nuevo queda en waiting hasta que la UI manda SKIP_WAITING
 * (botón "Actualizar y recargar" en Ajustes → Acerca de) o se cierran las pestañas.
 */
const VERSION = 'v3';
const STATIC_CACHE = `deltos-static-${VERSION}`;
const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); /* el SW nuevo toma control sin esperar (evita caché vieja) */
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

// === PUSH: recepción =========================================================
// REGLA CRÍTICA: TODO evento push termina en showNotification() — si no,
// Chrome muestra un aviso genérico y Safari REVOCA el permiso.
// El servidor envía payload híbrido: campos planos (title/body/url/tag) para
// este handler + bloque "web_push" (Declarative Web Push, Safari/iOS 18.4+).
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let datos = {};
      try {
        datos = event.data ? event.data.json() : {};
      } catch {
        datos = {}; // payload corrupto: se muestra el fallback igualmente
      }
      await self.registration.showNotification(datos.title || 'Deltos', {
        body: datos.body || 'Tienes actividad nueva',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: datos.tag || 'default', // coalescing: mismo tag reemplaza la anterior
        renotify: true,
        data: { url: datos.url || '/' },
        // NO actions/image/requireInteraction: no soportados en iOS.
      });
    })(),
  );
});

// === PUSH: click en la notificación ==========================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((lista) => {
        for (const cliente of lista) {
          if (cliente.url === url && 'focus' in cliente) return cliente.focus();
        }
        return clients.openWindow(url);
      }),
  );
});

// === PUSH: renovación automática de la suscripción ===========================
// Red de seguridad (cobertura irregular entre navegadores): re-suscribe y
// re-envía al servidor (upsert por endpoint). La higiene principal es el
// borrado por 404/410 en el sender.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          event.oldSubscription && event.oldSubscription.options
            ? event.oldSubscription.options.applicationServerKey
            : undefined,
      })
      .then((sub) =>
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub),
        }),
      ),
  );
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
