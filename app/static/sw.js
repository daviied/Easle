// App-shell cache: the UI opens instantly (even offline); data comes from the app's own IndexedDB cache.
const CACHE = 'easel-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/api.js', '/html.js', '/styles.css', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|login|logout|healthz)/.test(url.pathname)) return;
  // Stale-while-revalidate: serve cached shell, refresh it in the background.
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = e.request.mode === 'navigate' ? '/index.html' : e.request;
    const hit = await cache.match(key);
    const net = fetch(e.request).then((r) => {
      if (r.ok && r.type === 'basic') cache.put(key, r.clone());
      return r;
    }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
