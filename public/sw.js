// Service worker: hace instalable la PWA y muestra los avisos push.
// Solo se guarda la página de «sin conexión»: el resto siempre va a la laptop.
const CACHE = 'offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))).then(() => self.skipWaiting()),
));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Al abrir la app: si la laptop no responde (sin red, o Tailscale da 502/503/504 porque el servicio está caído),
// muestra la página de ayuda en vez del error del navegador.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.status < 502 || res.status > 504) return res;
      return (await caches.match(OFFLINE)) || res;
    } catch (err) {
      const page = await caches.match(OFFLINE);
      if (page) return page;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'Claude', {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.pane ? `/?pane=${encodeURIComponent(data.pane)}` : '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
