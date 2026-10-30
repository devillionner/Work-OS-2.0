const WORK_OS_CACHE_PREFIX = 'work-os-';

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(WORK_OS_CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});

// Сповіщення на телефон (Web Push): заголовок і текст приходять зашифрованими від воркера, клік відкриває потрібну картку.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Work OS', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'work-os:go', go: target.searchParams.get('go') || '' });
      return;
    }
    await self.clients.openWindow(target.href);
  }));
});
